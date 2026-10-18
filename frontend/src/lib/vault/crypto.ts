// Client-side key vault (envelope encryption). The server stores only the
// outputs of this module and can decrypt none of them.
//
//   seed (32 random bytes) ──AES-GCM(DEK)──► encryptedSeed
//   DEK  (32 random bytes) ──AES-GCM(KEK)──► wrappedDek, once per unlock method
//
//   KEK per method:
//     passkey   HKDF(WebAuthn PRF output)
//     pin       HKDF(Argon2id(PIN, salt) key half ‖ serverShare)
//     recovery  HKDF(128-bit recovery code)
//
// Every blob is versioned and bound to its purpose with AES-GCM associated
// data, so a wrapped key cannot be replayed as a different method's wrap.

import { argon2id } from "hash-wasm";

export const VAULT_FORMAT_VERSION = 1;
export type UnlockMethod = "passkey" | "pin" | "recovery";

const IV_BYTES = 12;
const KEY_BYTES = 32;

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

// --- encoding ---------------------------------------------------------------

export function toB64u(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64u(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new VaultError("Invalid base64url data.");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const utf8 = (text: string) => new TextEncoder().encode(text);

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Best-effort wipe of secret bytes once they are no longer needed. */
export function wipe(...buffers: (Uint8Array | null | undefined)[]) {
  for (const b of buffers) b?.fill(0);
}

// --- primitives -------------------------------------------------------------

/** HKDF-SHA256 to `length` bytes. Each label yields an independent key. */
export async function hkdf(ikm: Uint8Array, label: string, length = KEY_BYTES): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(`starlit:v${VAULT_FORMAT_VERSION}:${label}`) },
    base,
    length * 8
  );
  return new Uint8Array(bits);
}

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== KEY_BYTES) throw new VaultError("Keys must be 32 bytes.");
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Derives a non-extractable AES key-encryption key and wipes the raw bytes. */
export async function deriveKek(ikm: Uint8Array, label: string): Promise<CryptoKey> {
  const raw = await hkdf(ikm, label);
  try {
    return await aesKey(raw);
  } finally {
    wipe(raw);
  }
}

/** AES-256-GCM: base64url(version ‖ iv ‖ ciphertext+tag). */
async function sealBytes(key: CryptoKey, plaintext: Uint8Array, context: string): Promise<string> {
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: utf8(context) }, key, plaintext as BufferSource)
  );
  const out = new Uint8Array(1 + IV_BYTES + ct.length);
  out[0] = VAULT_FORMAT_VERSION;
  out.set(iv, 1);
  out.set(ct, 1 + IV_BYTES);
  return toB64u(out);
}

async function openBytes(key: CryptoKey, sealed: string, context: string): Promise<Uint8Array> {
  const raw = fromB64u(sealed);
  if (raw.length < 1 + IV_BYTES + 16 || raw[0] !== VAULT_FORMAT_VERSION) {
    throw new VaultError("Unsupported or corrupted vault data.");
  }
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.subarray(1, 1 + IV_BYTES) as BufferSource, additionalData: utf8(context) },
      key,
      raw.subarray(1 + IV_BYTES) as BufferSource
    );
    return new Uint8Array(pt);
  } catch {
    throw new VaultError("Could not unlock: wrong key or tampered data.");
  }
}

// --- seed and data key ------------------------------------------------------

export interface VaultSecrets {
  /** The master seed every wallet key is derived from. */
  seed: Uint8Array;
  /** Data key that encrypts the seed. */
  dek: Uint8Array;
}

export function createVaultSecrets(): VaultSecrets {
  return { seed: randomBytes(KEY_BYTES), dek: randomBytes(KEY_BYTES) };
}

const SEED_CONTEXT = "starlit-vault:seed";
const wrapContext = (method: UnlockMethod) => `starlit-vault:dek:${method}`;

export async function encryptSeed({ seed, dek }: VaultSecrets): Promise<string> {
  return sealBytes(await aesKey(dek), seed, SEED_CONTEXT);
}

export async function decryptSeed(encryptedSeed: string, dek: Uint8Array): Promise<Uint8Array> {
  const seed = await openBytes(await aesKey(dek), encryptedSeed, SEED_CONTEXT);
  if (seed.length !== KEY_BYTES) throw new VaultError("Corrupted seed.");
  return seed;
}

/** Wraps the data key under one unlock method's key-encryption key. */
export async function wrapDek(dek: Uint8Array, kek: CryptoKey, method: UnlockMethod): Promise<string> {
  return sealBytes(kek, dek, wrapContext(method));
}

export async function unwrapDek(wrappedDek: string, kek: CryptoKey, method: UnlockMethod): Promise<Uint8Array> {
  const dek = await openBytes(kek, wrappedDek, wrapContext(method));
  if (dek.length !== KEY_BYTES) throw new VaultError("Corrupted data key.");
  return dek;
}

// --- passkey (WebAuthn PRF) -------------------------------------------------

/**
 * Fixed PRF input for every Starlit credential. The authenticator mixes it with
 * a per-credential secret, so each passkey still yields a different output.
 */
export const PRF_SALT = utf8("starlit-vault-prf-v1".padEnd(32, "\0"));

/** Extension input for navigator.credentials.create()/get(). */
export function prfExtensionInput(): { prf: { eval: { first: BufferSource } } } {
  return { prf: { eval: { first: PRF_SALT as BufferSource } } };
}

/**
 * Reads the PRF output from a credential's client extension results, or null
 * when the authenticator did not return one (no PRF support).
 */
export function readPrfOutput(extensionResults: unknown): Uint8Array | null {
  const first = (extensionResults as { prf?: { results?: { first?: unknown } } } | null)?.prf?.results?.first;
  if (first instanceof ArrayBuffer) return new Uint8Array(first.slice(0));
  if (ArrayBuffer.isView(first)) return new Uint8Array(first.buffer.slice(first.byteOffset, first.byteOffset + first.byteLength));
  return null;
}

export async function kekFromPrf(prfOutput: Uint8Array): Promise<CryptoKey> {
  if (prfOutput.length < 32) throw new VaultError("Passkey returned too little key material.");
  return deriveKek(prfOutput, "kek:passkey");
}

// --- PIN (Argon2id + server share) ------------------------------------------

export interface Argon2Params {
  algorithm: "argon2id";
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  hashLength: number;
}

// Floors stop a misbehaving server from asking for weak stretching (which would
// make its stored verifier easier to brute-force); ceilings stop it from
// freezing the device.
const ARGON2_LIMITS = {
  minMemoryKiB: 19 * 1024,
  maxMemoryKiB: 256 * 1024,
  minIterations: 2,
  maxIterations: 10,
};

export function assertSafeArgon2Params(params: Argon2Params) {
  const ok =
    params?.algorithm === "argon2id" &&
    Number.isInteger(params.memoryKiB) &&
    params.memoryKiB >= ARGON2_LIMITS.minMemoryKiB &&
    params.memoryKiB <= ARGON2_LIMITS.maxMemoryKiB &&
    Number.isInteger(params.iterations) &&
    params.iterations >= ARGON2_LIMITS.minIterations &&
    params.iterations <= ARGON2_LIMITS.maxIterations &&
    Number.isInteger(params.parallelism) &&
    params.parallelism >= 1 &&
    params.parallelism <= 4 &&
    params.hashLength === 32;
  if (!ok) throw new VaultError("Refusing unsafe PIN protection settings from the server.");
}

export const isValidPin = (pin: string) => /^\d{6}$/.test(pin);

export interface StretchedPin {
  /** Sent to the server, which compares an HMAC of it. */
  verifier: string;
  /** Never leaves the device; combined with the server share into the KEK. */
  keyPart: Uint8Array;
}

export async function stretchPin(pin: string, saltB64u: string, params: Argon2Params): Promise<StretchedPin> {
  if (!isValidPin(pin)) throw new VaultError("PIN must be 6 digits.");
  assertSafeArgon2Params(params);
  const salt = fromB64u(saltB64u);
  if (salt.length < 16) throw new VaultError("PIN salt is too short.");

  const stretched = (await argon2id({
    password: pin,
    salt,
    iterations: params.iterations,
    memorySize: params.memoryKiB,
    parallelism: params.parallelism,
    hashLength: params.hashLength,
    outputType: "binary",
  })) as Uint8Array;

  const verifier = await hkdf(stretched, "pin:verifier");
  const keyPart = await hkdf(stretched, "pin:key");
  wipe(stretched);
  const encoded = toB64u(verifier);
  wipe(verifier);
  return { verifier: encoded, keyPart };
}

export async function kekFromPin(keyPart: Uint8Array, serverShareB64u: string): Promise<CryptoKey> {
  const share = fromB64u(serverShareB64u);
  if (share.length !== KEY_BYTES) throw new VaultError("Invalid server share.");
  const ikm = new Uint8Array(keyPart.length + share.length);
  ikm.set(keyPart, 0);
  ikm.set(share, keyPart.length);
  try {
    return await deriveKek(ikm, "kek:pin");
  } finally {
    wipe(ikm, share);
  }
}
