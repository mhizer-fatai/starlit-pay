import * as StellarSdk from "@stellar/stellar-sdk";
import {
  clearSession,
  getStoredUser,
  login,
  register,
  setSession,
  type BackendUser,
} from "@/lib/backend";

export type SessionUser = BackendUser;

const SECRET_SUFFIX = (email: string) => `starlit_secret:${email.toLowerCase()}`;

function randomHex(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function ensureKeys(email: string): { identity_commitment: string; public_encryption_key: string } {
  const existing = getStoredUser<BackendUser>();
  if (existing?.identity_commitment && existing?.public_encryption_key) {
    return {
      identity_commitment: existing.identity_commitment,
      public_encryption_key: existing.public_encryption_key,
    };
  }
  // Deterministic-ish per browser: reuse stored secret if present, else create Stellar keypair.
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
    try {
      localStorage.setItem(SECRET_SUFFIX(email), secret);
    } catch {
      /* ignore */
    }
  }
  return { identity_commitment: randomHex(), public_encryption_key: keypair.publicKey() };
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
  });
  setSession(res.token, res.user);
  return res.user;
}

// Google OAuth bridge: Supabase gives us a verified email (+ profile); the
// Express backend owns the user row + JWT session. First login auto-registers.
export async function signInWithGoogle(
  email: string,
  profile?: { displayName?: string; avatarUrl?: string },
): Promise<SessionUser> {
  const clean = email.toLowerCase().trim();
  const res = await login(clean);
  if (res.exists !== false && res.user) {
    setSession(res.token, res.user);
    return res.user;
  }
  const base = clean.split("@")[0]!.replace(/[^a-z0-9_]/g, "_").slice(0, 24) || "user";
  const keys = ensureKeys(clean);
  const reg = await register({
    email: clean,
    username: `${base}_${Math.floor(100 + Math.random() * 900)}`,
    display_name: profile?.displayName || base,
    identity_commitment: keys.identity_commitment,
    public_encryption_key: keys.public_encryption_key,
    avatar_url: profile?.avatarUrl,
  });
  setSession(reg.token, reg.user);
  return reg.user;
}

export async function signOut(): Promise<void> {
  clearSession();
}

export async function updateUserProfile(
  _id: string,
  _updates: Partial<Pick<SessionUser, "display_name" | "email" | "avatar_url">>,
): Promise<void> {
  // Backend has no profile-update endpoint; profile edits are local-only for now.
  const user = await getUser();
  if (!user) return;
  try {
    localStorage.setItem("starlit_user", JSON.stringify({ ...user, ..._updates }));
  } catch {
    /* ignore */
  }
}
