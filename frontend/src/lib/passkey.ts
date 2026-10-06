// WebAuthn Passkey (CAP-0051 / secp256r1) Client Authentication Module
// Provides hardware-backed biometric authentication (Face ID, Touch ID, Windows Hello)
// and cryptographic seed derivation for Starlit Pay.

import { Buffer } from "buffer";
import * as StellarSdk from "@stellar/stellar-sdk";
import nacl from "tweetnacl";
import { sha256 } from "./auth";

export interface PasskeyRegistrationResult {
  credentialId: string;
  publicKeyHex: string;
  rawIdHex: string;
  seedHex: string;
}

export interface PasskeyAuthResult {
  credentialId: string;
  signatureHex: string;
  clientDataJson: string;
  authenticatorDataHex: string;
  seedHex: string;
}

function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function isPasskeySupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.PublicKeyCredential !== undefined &&
    typeof window.PublicKeyCredential === "function"
  );
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isPasskeySupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Registers a new hardware-bound Passkey credential on the device Secure Enclave
 * using the ES256 (secp256r1) algorithm (native to Stellar Soroban CAP-0051).
 */
export async function registerPasskey(
  username: string,
  displayName: string,
  challengeString?: string,
): Promise<PasskeyRegistrationResult> {
  if (!isPasskeySupported()) {
    throw new Error("Passkeys are not supported in this browser environment.");
  }

  const cleanChallenge = challengeString || `starlit-reg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const challengeBytes = await sha256(cleanChallenge);

  const userIdBytes = new Uint8Array(16);
  crypto.getRandomValues(userIdBytes);

  const createOptions: PublicKeyCredentialCreationOptions = {
    challenge: challengeBytes as unknown as ArrayBuffer,
    rp: {
      name: "Starlit Pay",
      id: window.location.hostname === "localhost" ? "localhost" : window.location.hostname,
    },
    user: {
      id: userIdBytes,
      name: username.toLowerCase().trim(),
      displayName: displayName.trim() || username.trim(),
    },
    pubKeyCredParams: [
      { alg: -7, type: "public-key" }, // ES256 (secp256r1) - Soroban CAP-0051 compatible
    ],
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      userVerification: "required",
      residentKey: "preferred",
    },
    timeout: 60000,
    attestation: "none",
  };

  const credential = (await navigator.credentials.create({
    publicKey: createOptions,
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("Passkey registration was cancelled or rejected by user.");
  }

  const rawIdHex = bufferToHex(credential.rawId);
  const response = credential.response as AuthenticatorAttestationResponse;
  const publicKeyBuffer = response.getPublicKey ? response.getPublicKey() : null;
  const publicKeyHex = publicKeyBuffer ? bufferToHex(publicKeyBuffer) : rawIdHex;

  // Derive deterministic 256-bit master seed from hardware credential ID and origin
  const seedMaterial = `${rawIdHex}:${window.location.origin}`;
  const seedBytes = await sha256(seedMaterial);
  const seedHex = bufferToHex(seedBytes);

  return {
    credentialId: credential.id,
    publicKeyHex,
    rawIdHex,
    seedHex,
  };
}

/**
 * Authenticates using an enrolled Passkey via Touch ID, Face ID, or Windows Hello.
 * Generates hardware-verified assertion and derives client cryptographic master seed.
 */
export async function authenticatePasskey(
  allowedCredentialId?: string,
  challengeString?: string,
): Promise<PasskeyAuthResult> {
  if (!isPasskeySupported()) {
    throw new Error("Passkeys are not supported in this browser environment.");
  }

  const cleanChallenge = challengeString || `starlit-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const challengeBytes = await sha256(cleanChallenge);

  const getOptions: PublicKeyCredentialRequestOptions = {
    challenge: challengeBytes as unknown as ArrayBuffer,
    rpId: window.location.hostname === "localhost" ? "localhost" : window.location.hostname,
    userVerification: "required",
    timeout: 60000,
  };

  if (allowedCredentialId) {
    getOptions.allowCredentials = [
      {
        id: hexToBytes(allowedCredentialId) as unknown as ArrayBuffer,
        type: "public-key",
        transports: ["internal"],
      },
    ];
  }

  const credential = (await navigator.credentials.get({
    publicKey: getOptions,
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("Passkey authentication was cancelled or rejected by user.");
  }

  const rawIdHex = bufferToHex(credential.rawId);
  const response = credential.response as AuthenticatorAssertionResponse;
  const signatureHex = bufferToHex(response.signature);
  const authenticatorDataHex = bufferToHex(response.authenticatorData);
  const clientDataJson = new TextDecoder().decode(response.clientDataJSON);

  // Derive deterministic 256-bit master seed from hardware credential ID and origin
  const seedMaterial = `${rawIdHex}:${window.location.origin}`;
  const seedBytes = await sha256(seedMaterial);
  const seedHex = bufferToHex(seedBytes);

  return {
    credentialId: credential.id,
    signatureHex,
    clientDataJson,
    authenticatorDataHex,
    seedHex,
  };
}

/**
 * Derives full Starlit Pay cryptographic suite from a hardware Passkey master seed:
 * 1. Viewing keypair (Curve25519 nacl.box) for encrypted notes
 * 2. Spending key (scalar field element for ZK nullifiers)
 * 3. Stellar gas keypair (Ed25519)
 */
export async function deriveKeysFromPasskeySeed(seedHex: string) {
  const masterSeed = hexToBytes(seedHex);

  const stellarSeed = await sha256(`${seedHex}:stellar`);
  const stellarKeypair = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.from(stellarSeed));

  const zkSpendingSeed = await sha256(`${seedHex}:spending`);
  const zkSpendingKey = bufferToHex(zkSpendingSeed);

  const viewingSeed = await sha256(`${seedHex}:viewing`);
  const viewingKeyPair = nacl.box.keyPair.fromSecretKey(viewingSeed);

  return {
    masterSeed: seedHex,
    stellar: {
      publicKey: stellarKeypair.publicKey(),
      secretKey: stellarKeypair.secret(),
      keypair: stellarKeypair,
    },
    spendingKey: zkSpendingKey,
    viewing: {
      publicKey: bufferToHex(viewingKeyPair.publicKey),
      secretKey: bufferToHex(viewingKeyPair.secretKey),
    },
  };
}

/**
 * Symmetrically encrypts the user's wallet secrets using the hardware Passkey master seed
 */
export function encryptVaultWithPasskeySeed(
  secrets: { viewingSecret: string; stellarSecret: string; spendingKey: string },
  passkeySeedHex: string,
): string {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const key = hexToBytes(passkeySeedHex.slice(0, 64));
  const payload = JSON.stringify(secrets);
  const msg = new TextEncoder().encode(payload);
  const box = nacl.secretbox(msg, nonce, key);
  return bufferToHex(nonce) + bufferToHex(box);
}

/**
 * Decrypts the user's wallet secrets using the hardware Passkey master seed
 */
export function decryptVaultWithPasskeySeed(
  vaultHex: string,
  passkeySeedHex: string,
): { viewingSecret: string; stellarSecret: string; spendingKey: string } | null {
  try {
    const nonceLen = nacl.secretbox.nonceLength * 2;
    const nonce = hexToBytes(vaultHex.substring(0, nonceLen));
    const box = hexToBytes(vaultHex.substring(nonceLen));
    const key = hexToBytes(passkeySeedHex.slice(0, 64));
    const opened = nacl.secretbox.open(box, nonce, key);
    if (!opened) return null;
    const str = new TextDecoder().decode(opened);
    return JSON.parse(str);
  } catch {
    return null;
  }
}

export function hasBiometricEnrolled(email: string): boolean {
  if (!email) return false;
  return !!localStorage.getItem(`starlit_biometric_vault:${email.toLowerCase()}`);
}

export function saveBiometricVault(
  email: string,
  passkeySeedHex: string,
  secrets: { viewingSecret: string; stellarSecret: string; spendingKey: string },
  credentialId?: string,
): void {
  const vaultHex = encryptVaultWithPasskeySeed(secrets, passkeySeedHex);
  localStorage.setItem(`starlit_biometric_vault:${email.toLowerCase()}`, vaultHex);
  if (credentialId) {
    localStorage.setItem(`starlit_passkey_cred:${email.toLowerCase()}`, credentialId);
  }
}

export function unlockBiometricVault(
  email: string,
  passkeySeedHex: string,
): { viewingSecret: string; stellarSecret: string; spendingKey: string } | null {
  const vault = localStorage.getItem(`starlit_biometric_vault:${email.toLowerCase()}`);
  if (!vault) return null;
  return decryptVaultWithPasskeySeed(vault, passkeySeedHex);
}
