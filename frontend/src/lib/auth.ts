import { clearSession, getStoredUser, login, setStoredUser, updateProfile, type BackendUser } from "@/lib/backend";
import { supabase } from "@/lib/supabase";
import { sha256, type DerivedKeys } from "@/lib/keys";
import { closeVault, type OpenedVault, type VaultSecrets } from "@/lib/vault";
import { authApi, getEmailProof } from "@/lib/vault/client";
import { closePrivateSession } from "@/lib/privatePool";

export { sha256 };

export type SessionUser = BackendUser;

// The wallet's keys while unlocked. They live in this page's memory only: they
// are never written to localStorage or any other browser storage.
let unlockedKeys: DerivedKeys | null = null;
let unlockedThisLoad = false;

// Passkey accounts: the session is an httpOnly cookie and the keys exist only
// in memory while unlocked. This flag (not a secret) records which kind of
// account is signed in on this browser.
const AUTH_MODE_KEY = "starlit_auth_mode";
let vaultSecrets: VaultSecrets | null = null;

export function isVaultMode(): boolean {
  try {
    return localStorage.getItem(AUTH_MODE_KEY) === "vault";
  } catch {
    return false;
  }
}

/** Signs in a passkey account: keys and vault secrets stay in memory only. */
export function unlockFromVault(opened: OpenedVault, user: SessionUser) {
  if (vaultSecrets && vaultSecrets !== opened.secrets) closeVault(vaultSecrets);
  vaultSecrets = opened.secrets;
  unlockedKeys = opened.keys;
  unlockedThisLoad = true;
  setStoredUser(user);
  try {
    localStorage.setItem(AUTH_MODE_KEY, "vault");
  } catch {
    /* ignore */
  }
}

/** Secrets of the open vault, needed to add unlock methods. Null when locked. */
export function getVaultSecrets(): VaultSecrets | null {
  return vaultSecrets;
}

export function isUnlocked(): boolean {
  return unlockedThisLoad && unlockedKeys !== null;
}

/** The unlocked wallet's keys, or null when locked (after a reload, until the passkey or PIN unlocks it). */
export function getUnlockedKeys(): DerivedKeys | null {
  return unlockedKeys;
}

export function lockSession() {
  // Closes the private-pool database so its decrypted notes leave memory.
  void closePrivateSession();
  unlockedKeys = null;
  unlockedThisLoad = false;
  closeVault(vaultSecrets);
  vaultSecrets = null;
}

export async function getUser(): Promise<SessionUser | null> {
  if (!isVaultMode()) return null;
  return getStoredUser<SessionUser>();
}

/** Lookup mode: checks whether a backend user row exists. Issues NO token. */
export async function lookupByEmail(
  email: string,
): Promise<{ exists: boolean; user: SessionUser | null }> {
  const res = await login(email.toLowerCase().trim(), undefined, await getEmailProof());
  if (res.exists === false || !res.user) return { exists: false, user: null };
  return { exists: true, user: res.user };
}

export async function signOut(): Promise<void> {
  if (isVaultMode()) await authApi.logout().catch(() => undefined);
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
  if (res.user) setStoredUser(res.user);
}

