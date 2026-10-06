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
import {
  deriveKeysFromEmailAndPin,
  identityCommitment,
  type DerivedKeys,
} from "@/lib/keys";

export type SessionUser = BackendUser;

// Derived wallet keys live in memory ONLY — never in any storage. A page
// reload wipes them, and the app treats that as locked until the PIN is
// re-entered (see isUnlocked + RequireUnlock).
let unlockedKeys: DerivedKeys | null = null;

// True only if the PIN was entered during THIS page load. In-memory on
// purpose: a tab refresh always resets it to false, forcing PIN re-entry.
let unlockedThisLoad = false;

export function isUnlocked(): boolean {
  return unlockedThisLoad;
}

export function getUnlockedKeys(): DerivedKeys | null {
  if (!unlockedThisLoad) return null;
  return unlockedKeys;
}

function markUnlocked(keys: DerivedKeys) {
  unlockedKeys = keys;
  unlockedThisLoad = true;
}

function lockSession() {
  unlockedKeys = null;
  unlockedThisLoad = false;
}

export async function getUser(): Promise<SessionUser | null> {
  // A stored user object alone is not a session — require the backend JWT too,
  // otherwise a stale `starlit_user` entry auto-"authenticates" every visit.
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
 * Stores `identity_commitment = sha256(spendingKey)` so the PIN can be
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
  markUnlocked(derived);
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
  markUnlocked(derived);
  return res.user;
}

export async function signOut(): Promise<void> {
  clearSession();
  lockSession();
  // Supabase persists its own session (sb-*-auth-token in localStorage).
  // If left behind, /auth would see it and silently sign the user back in.
  try {
    await supabase.auth.signOut();
  } catch {
    /* ignore */
  }
}

export async function updateUserProfile(
  _id: string,
  _updates: Partial<Pick<SessionUser, "display_name" | "email" | "avatar_url">>,
): Promise<void> {
  // Persist to the database first so every device/session sees the change,
  // then refresh the local session copy. Only display name + avatar are
  // editable (email/username are identity and never change here).
  const body: { display_name?: string; avatar_url?: string } = {};
  if (typeof _updates.display_name === "string") body.display_name = _updates.display_name;
  if (typeof _updates.avatar_url === "string") body.avatar_url = _updates.avatar_url;
  const res = await updateProfile(body);
  const token = getToken();
  if (token && res.user) setSession(token, res.user);
}
