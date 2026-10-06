import { Buffer } from "buffer";
import nacl from "tweetnacl";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  clearSession,
  getStoredUser,
  login,
  register,
  setSession,
  updateProfile,
  type BackendUser,
} from "@/lib/backend";
import { supabase } from "@/lib/supabase";

export type SessionUser = BackendUser;

const SECRET_SUFFIX = (email: string) => `starlit_secret:${email.toLowerCase()}`;
const VIEWING_SECRET_KEY = (email: string) => `starlit_viewing_secret:${email.toLowerCase()}`;

function randomHex(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function ensureKeys(email: string): {
  identity_commitment: string;
  public_encryption_key: string;
  stellar_address: string;
} {
  const existing = getStoredUser<BackendUser>();

  // 1. Ed25519 Stellar keypair
  let secret = localStorage.getItem(SECRET_SUFFIX(email));
  let keypair: StellarSdk.Keypair;
  if (secret) {
    try {
      keypair = StellarSdk.Keypair.fromSecret(secret);
    } catch {
      keypair = StellarSdk.Keypair.random();
      secret = keypair.secret();
      localStorage.setItem(SECRET_SUFFIX(email), secret);
    }
  } else {
    keypair = StellarSdk.Keypair.random();
    secret = keypair.secret();
    localStorage.setItem(SECRET_SUFFIX(email), secret);
  }

  // 2. Curve25519 nacl.box viewing keypair
  let viewingSecretHex = localStorage.getItem(VIEWING_SECRET_KEY(email));
  let viewingKeyPair: nacl.BoxKeyPair;
  if (viewingSecretHex) {
    try {
      viewingKeyPair = nacl.box.keyPair.fromSecretKey(hexToBytes(viewingSecretHex));
    } catch {
      viewingKeyPair = nacl.box.keyPair();
      localStorage.setItem(VIEWING_SECRET_KEY(email), bytesToHex(viewingKeyPair.secretKey));
    }
  } else {
    viewingKeyPair = nacl.box.keyPair();
    localStorage.setItem(VIEWING_SECRET_KEY(email), bytesToHex(viewingKeyPair.secretKey));
  }

  const viewingPublicKeyHex = bytesToHex(viewingKeyPair.publicKey);
  const stellarAddress = keypair.publicKey();

  return {
    identity_commitment: existing?.identity_commitment || randomHex(),
    public_encryption_key: viewingPublicKeyHex,
    stellar_address: stellarAddress,
  };
}

export async function sha256(message: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hashBuffer = await crypto.subtle.digest("SHA-256", copy);
  return new Uint8Array(hashBuffer);
}

export async function deriveKeysFromEmailAndPin(email: string, pin: string) {
  const cleanEmail = email.toLowerCase().trim();
  const cleanPin = pin.trim();

  const combinedSalt = `${cleanEmail}:${cleanPin}`;
  const masterSeed = await sha256(combinedSalt);
  const masterSeedHex = bytesToHex(masterSeed);

  const stellarSeed = await sha256(`${masterSeedHex}:stellar`);
  const stellarKeypair = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.from(stellarSeed));

  const zkSpendingSeed = await sha256(`${masterSeedHex}:spending`);
  const zkSpendingKey = bytesToHex(zkSpendingSeed);

  const viewingSeed = await sha256(`${masterSeedHex}:viewing`);
  const viewingKeyPair = nacl.box.keyPair.fromSecretKey(viewingSeed);

  return {
    masterSeed: masterSeedHex,
    stellar: {
      publicKey: stellarKeypair.publicKey(),
      secretKey: stellarKeypair.secret(),
      keypair: stellarKeypair,
    },
    spendingKey: zkSpendingKey,
    viewing: {
      publicKey: bytesToHex(viewingKeyPair.publicKey),
      secretKey: bytesToHex(viewingKeyPair.secretKey),
    },
  };
}

export async function unlockWalletWithPin(
  email: string,
  pin: string,
  expectedCommitment?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const derived = await deriveKeysFromEmailAndPin(email, pin);
    if (expectedCommitment) {
      const hashedSpendingKey = bytesToHex(await sha256(derived.spendingKey));
      if (hashedSpendingKey !== expectedCommitment) {
        return { success: false, error: "Incorrect 6-digit PIN" };
      }
    }
    localStorage.setItem(VIEWING_SECRET_KEY(email), derived.viewing.secretKey);
    localStorage.setItem(SECRET_SUFFIX(email), derived.stellar.secretKey);
    localStorage.setItem(`starlit_spending:${email.toLowerCase()}`, derived.spendingKey);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to derive keys" };
  }
}

export function isWalletUnlocked(email: string): boolean {
  return !!localStorage.getItem(VIEWING_SECRET_KEY(email));
}

export function getSpendingKey(email: string): string | null {
  try {
    return localStorage.getItem(`starlit_spending:${email.toLowerCase()}`);
  } catch {
    return null;
  }
}

export function signAuthRequest(email: string, message: string): string | null {
  try {
    const secret = localStorage.getItem(SECRET_SUFFIX(email));
    if (!secret) return null;
    const keypair = StellarSdk.Keypair.fromSecret(secret);
    const signatureBytes = keypair.sign(Buffer.from(message));
    return bytesToHex(signatureBytes);
  } catch {
    return null;
  }
}

export function getViewingSecret(email: string): string | null {
  try {
    return localStorage.getItem(VIEWING_SECRET_KEY(email));
  } catch {
    return null;
  }
}

export async function getUser(): Promise<SessionUser | null> {
  return getStoredUser<SessionUser>();
}

export async function signInWithEmail(email: string): Promise<{ registered: boolean; user: SessionUser }> {
  const res = await login(email.toLowerCase().trim());
  if (res.exists === false || !res.user) return { registered: false, user: null as unknown as SessionUser };
  setSession(res.token, res.user);
  return { registered: true, user: res.user };
}

export async function registerWithEmail(args: {
  email: string;
  username: string;
  displayName: string;
}): Promise<SessionUser> {
  const keys = ensureKeys(args.email);
  const res = await register({
    email: args.email.toLowerCase().trim(),
    username: args.username.toLowerCase().trim().replace(/^@/, ""),
    display_name: args.displayName.trim() || args.username.trim(),
    identity_commitment: keys.identity_commitment,
    public_encryption_key: keys.public_encryption_key,
    stellar_address: keys.stellar_address,
  });
  setSession(res.token, res.user);
  return res.user;
}



export async function signOut(): Promise<void> {
  clearSession();
  try {
    await supabase.auth.signOut();
  } catch {
    /* ignore */
  }
}

export async function updateUserProfile(
  _id: string,
  updates: Partial<Pick<SessionUser, "display_name" | "email" | "avatar_url">>,
): Promise<void> {
  const user = await getUser();
  if (!user) return;
  try {
    const updated = { ...user, ...updates };
    localStorage.setItem("starlit_user", JSON.stringify(updated));
    await updateProfile({
      display_name: updates.display_name ?? undefined,
      avatar_url: updates.avatar_url ?? undefined,
    });
  } catch {
    /* ignore offline */
  }
}

