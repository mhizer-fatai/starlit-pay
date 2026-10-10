import * as StellarSdk from "@stellar/stellar-sdk";
import {
  clearSession,
  getStoredUser,
  getToken,
  login,
  register,
  setSession,
  updateProfile,
  type BackendUser,
} from "@/lib/backend";
import { supabase } from "@/lib/supabase";
import nacl from "tweetnacl";
import {
  bytesToHex,
  deriveKeysFromEmailAndPin,
  hexToBytes,
  identityCommitment,
  sha256,
  type DerivedKeys,
} from "@/lib/keys";

export { sha256 };

export type SessionUser = BackendUser;

const SECRET_SUFFIX = (email: string) => `starlit_secret:${email.toLowerCase()}`;
const VIEWING_SECRET_KEY = (email: string) => `starlit_viewing_secret:${email.toLowerCase()}`;
const SPENDING_KEY_SUFFIX = (email: string) => `starlit_spending:${email.toLowerCase()}`;

let unlockedKeys: DerivedKeys | null = null;
let unlockedThisLoad = false;

export function isUnlocked(): boolean {
  return unlockedThisLoad || (typeof window !== "undefined" && !!getUnlockedKeys());
}

export function getUnlockedKeys(userEmail?: string): DerivedKeys | null {
  if (unlockedKeys) return unlockedKeys;
  const email = userEmail || getStoredUser<SessionUser>()?.email;
  if (email && typeof window !== "undefined") {
    try {
      const viewingSecret = localStorage.getItem(VIEWING_SECRET_KEY(email));
      const stellarSecret = localStorage.getItem(SECRET_SUFFIX(email));
      const spendingKey = localStorage.getItem(SPENDING_KEY_SUFFIX(email));
      if (viewingSecret && stellarSecret && spendingKey) {
        const viewingKeyPair = nacl.box.keyPair.fromSecretKey(hexToBytes(viewingSecret));
        const stellarKeypair = StellarSdk.Keypair.fromSecret(stellarSecret);
        unlockedKeys = {
          masterSeed: "",
          stellar: {
            publicKey: stellarKeypair.publicKey(),
            secretKey: stellarSecret,
          },
          spendingKey,
          viewing: {
            publicKey: bytesToHex(viewingKeyPair.publicKey),
            secretKey: viewingSecret,
          },
        };
        unlockedThisLoad = true;
        return unlockedKeys;
      }
    } catch {
      /* ignore storage errors */
    }
  }
  return null;
}

export function markUnlocked(keys: DerivedKeys, email?: string) {
  unlockedKeys = keys;
  unlockedThisLoad = true;
  if (email && typeof window !== "undefined") {
    try {
      localStorage.setItem(VIEWING_SECRET_KEY(email), keys.viewing.secretKey);
      localStorage.setItem(SECRET_SUFFIX(email), keys.stellar.secretKey);
      localStorage.setItem(SPENDING_KEY_SUFFIX(email), keys.spendingKey);
    } catch {
      /* ignore storage errors */
    }
  }
}

export function lockSession() {
  unlockedKeys = null;
  unlockedThisLoad = false;
}

export function getSpendingKey(email: string): string | null {
  if (unlockedKeys?.spendingKey) return unlockedKeys.spendingKey;
  try {
    return localStorage.getItem(SPENDING_KEY_SUFFIX(email));
  } catch {
    return null;
  }
}

export function getViewingSecret(email: string): string | null {
  if (unlockedKeys?.viewing?.secretKey) return unlockedKeys.viewing.secretKey;
  try {
    return localStorage.getItem(VIEWING_SECRET_KEY(email));
  } catch {
    return null;
  }
}

export function signAuthRequest(email: string, message: string): string | null {
  try {
    let secret = unlockedKeys?.stellar?.secretKey;
    if (!secret && typeof window !== "undefined") {
      secret = localStorage.getItem(SECRET_SUFFIX(email)) || undefined;
    }
    if (!secret) return null;
    const keypair = StellarSdk.Keypair.fromSecret(secret);
    const signatureBytes = keypair.sign(Buffer.from(message));
    return bytesToHex(signatureBytes);
  } catch {
    return null;
  }
}

export function isWalletUnlocked(email: string): boolean {
  if (unlockedThisLoad) return true;
  try {
    return !!localStorage.getItem(VIEWING_SECRET_KEY(email));
  } catch {
    return false;
  }
}

export async function unlockWalletWithPin(
  email: string,
  pin: string,
  expectedCommitment?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const derived = await deriveKeysFromEmailAndPin(email, pin);
    if (expectedCommitment) {
      const commitment = await identityCommitment(derived.spendingKey);
      if (commitment !== expectedCommitment) {
        return { success: false, error: "Incorrect 6-digit PIN" };
      }
    }
    markUnlocked(derived, email);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to derive keys" };
  }
}

export async function getUser(): Promise<SessionUser | null> {
  if (!getToken()) return null;
  return getStoredUser<SessionUser>();
}

/** Lookup mode: checks whether a backend user row exists. Issues NO token. */
export async function lookupByEmail(
  email: string,
): Promise<{ exists: boolean; user: SessionUser | null }> {
  const res = await login(email.toLowerCase().trim());
  if (res.exists === false || !res.user) return { exists: false, user: null };
  return { exists: true, user: res.user };
}

/**
 * New account: derives wallet keys from email + PIN and registers.
 * Stores identity_commitment = sha256(spendingKey) so the PIN can be
 * verified later without ever persisting the keys.
 */
export async function registerWithPin(args: {
  email: string;
  username: string;
  displayName: string;
  pin: string;
  avatarUrl?: string;
}): Promise<SessionUser> {
  const clean = args.email.toLowerCase().trim();
  const derived = await deriveKeysFromEmailAndPin(clean, args.pin);
  const res = await register({
    email: clean,
    username: args.username.toLowerCase().trim().replace(/^@/, ""),
    display_name: args.displayName.trim() || args.username.trim(),
    identity_commitment: await identityCommitment(derived.spendingKey),
    public_encryption_key: derived.viewing.publicKey,
    avatar_url: args.avatarUrl,
    stellar_address: derived.stellar.publicKey,
  });
  if (!res.token || !res.user) throw new Error("Registration failed.");
  setSession(res.token, res.user);
  markUnlocked(derived, clean);
  return res.user;
}

/**
 * Existing account: re-derives keys from email + PIN and lets the backend
 * verify the commitment before it issues a JWT (401 on wrong PIN).
 */
export async function unlockWithPin(email: string, pin: string): Promise<SessionUser> {
  const clean = email.toLowerCase().trim();
  const derived = await deriveKeysFromEmailAndPin(clean, pin);
  const res = await login(clean, await identityCommitment(derived.spendingKey));
  if (res.exists === false || !res.user || !res.token) {
    throw new Error("Account not found. Please create a PIN first.");
  }
  setSession(res.token, res.user);
  markUnlocked(derived, clean);
  return res.user;
}

export async function signOut(): Promise<void> {
  clearSession();
  lockSession();
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
  const body: { display_name?: string; avatar_url?: string } = {};
  if (typeof updates.display_name === "string") body.display_name = updates.display_name;
  if (typeof updates.avatar_url === "string") body.avatar_url = updates.avatar_url;
  const res = await updateProfile(body);
  const token = getToken();
  if (token && res.user) setSession(token, res.user);
}

