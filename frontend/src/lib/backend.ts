// Typed client for the starlit-pay backend (Express :3001 / onrender).
// Preserves every read/write the old JSX frontend used.

import { refreshOnce, refreshSucceeded, RETRYABLE_SESSION_CODES } from "@/lib/sessionRefresh";

const DEFAULT_LOCAL = "http://localhost:3001";
// Same site as starlitpay.xyz, so session cookies are first-party (Safari/iOS block cross-site cookies).
const DEFAULT_REMOTE = "https://api.starlitpay.xyz";

export const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ||
  (typeof window !== "undefined" && window.location.hostname === "localhost"
    ? DEFAULT_LOCAL
    : DEFAULT_REMOTE);

const USER_KEY = "starlit_user";

export function clearSession() {
  try {
    localStorage.removeItem(USER_KEY);
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("starlit") || k.startsWith("sb-"))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
}
/** Remembers the (non-secret) profile for passkey sessions, which use cookies instead of a stored token. */
export function setStoredUser(user: unknown) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}
export function getStoredUser<T>(): T | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export class BackendError extends Error {
  status: number;
  /** The server's machine-readable reason, when it gave one (e.g. "CHANNELS_BUSY"). */
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function refreshSessionCookie(): Promise<boolean> {
  return refreshOnce(() =>
    fetch(`${BACKEND_URL}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Requested-With": "starlit" },
      body: "{}",
    }).then(refreshSucceeded)
  );
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // X-Requested-With is the CSRF header the backend requires when a request is
  // authenticated by the passkey session cookie (credentials: "include").
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Requested-With": "starlit" };
  const send = () =>
    fetch(`${BACKEND_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: { ...headers, ...init?.headers },
    });
  let res = await send();
  // The 15-minute access cookie ran out: renew it (once for the whole app) and retry.
  if (res.status === 401) {
    const peek = (await res.clone().json().catch(() => null)) as { code?: string } | null;
    if (RETRYABLE_SESSION_CODES.has(peek?.code ?? "") && (await refreshSessionCookie())) res = await send();
  }
  if (!res.ok) {
    let msg = `Backend ${res.status}: ${path}`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; message?: string; code?: string };
      msg = body.error || body.message || msg;
      code = body.code;
    } catch {
      /* non-JSON */
    }
    throw new BackendError(res.status, msg, code);
  }
  return res.json() as Promise<T>;
}

export interface BackendUser {
  id: string;
  email: string;
  username: string;
  display_name?: string | null;
  identity_commitment?: string | null;
  public_encryption_key?: string | null;
  avatar_url?: string | null;
  stellar_address?: string | null;
  deposit_memo?: string | null;
}

export interface AuthResponse {
  exists?: boolean;
  user?: BackendUser;
}

// --- Auth / users (read + write) ---
// Lookup mode (no identity_commitment): returns { exists, user? } WITHOUT a
// token so a JWT is never issued before the PIN is verified.
// Unlock mode (with identity_commitment): backend verifies the PIN-derived
// commitment and only then returns { exists: true, user, token }.
export const login = (email: string, identity_commitment?: string, emailProof?: string | null) =>
  req<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(
      identity_commitment ? { email, identity_commitment } : { email },
    ),
    // The backend answers only the owner of the email (Google sign-in).
    headers: emailProof ? { "X-Supabase-Auth": emailProof } : undefined,
  });

export const register = (body: {
  email: string;
  username: string;
  identity_commitment: string;
  public_encryption_key: string;
  display_name?: string;
  avatar_url?: string;
  stellar_address?: string;
  /** Closed beta: needed while sign-up is invite-only. */
  invite_code?: string;
}, emailProof?: string) =>
  // The backend requires Google proof that the caller owns this email.
  req<AuthResponse>("/api/users/register", {
    method: "POST",
    body: JSON.stringify(body),
    headers: emailProof ? { "X-Supabase-Auth": emailProof } : undefined,
  });

export const lookupUser = (username: string) =>
  req<{ user: BackendUser }>(`/api/users/lookup/${encodeURIComponent(username.replace(/^@/, ""))}`);

// Authenticated self-profile update (display name + avatar only).
export const updateProfile = (body: { display_name?: string; avatar_url?: string }) =>
  req<{ user: BackendUser }>("/api/users/me", { method: "PATCH", body: JSON.stringify(body) });

export interface UserSettings {
  user_id: string;
  language: string;
  currency: string;
  notif_email: boolean;
  notif_push: boolean;
  notif_sms: boolean;
  notif_marketing: boolean;
  sec_passkey: boolean;
  sec_google: boolean;
  sec_email: boolean;
  sec_phone: boolean;
  sec_password: boolean;
  updated_at?: string;
}

export type SettingsUpdate = Partial<
  Pick<
    UserSettings,
    | "language"
    | "currency"
    | "notif_email"
    | "notif_push"
    | "notif_sms"
    | "notif_marketing"
    | "sec_passkey"
    | "sec_google"
    | "sec_email"
    | "sec_phone"
    | "sec_password"
  >
>;

// Per-account settings (requires the user_settings table — see schema_settings.sql).
export const fetchSettings = () =>
  req<{ settings: UserSettings }>("/api/users/me/settings");
export const updateSettings = (body: SettingsUpdate) =>
  req<{ settings: UserSettings }>(
    "/api/users/me/settings",
    { method: "PATCH", body: JSON.stringify(body) },
  );

// --- Payment links (read + write) ---
export interface PaymentLink {
  id?: string;
  commitment: string;
  creator_id: string;
  amount: string | number;
  asset?: string;
  description?: string | null;
  status?: string;
  created_at?: string;
}
export const createPaymentLink = (body: {
  creator_id: string;
  amount: string | number;
  commitment: string;
  asset?: string;
  description?: string;
}) => req<{ link: PaymentLink }>("/api/payment-links", { method: "POST", body: JSON.stringify(body) });

export const fetchPaymentLink = (commitment: string) =>
  req<{ link: PaymentLink & { creator?: BackendUser } }>(
    `/api/payment-links/${encodeURIComponent(commitment)}`,
  );
export const claimPaymentLink = (commitment: string, txHash?: string) =>
  req<{ link: PaymentLink }>(`/api/payment-links/${encodeURIComponent(commitment)}/claim`, {
    method: "POST",
    body: JSON.stringify({ txHash }),
  });

// --- Faucet (read + write) ---
export const faucetStatus = (viewingKey: string) =>
  req<{ canClaim: boolean; remainingMs: number; nextClaimAt?: string }>(
    `/api/faucet/status/${encodeURIComponent(viewingKey)}`,
  );
export const faucetFund = (body: { viewingKey: string; depositMemo?: string; timestamp?: string; signature?: string; captchaToken?: string }) =>
  req<{ success: boolean; hash?: string; amountXlm?: number; amountUsdc?: number }>(
    "/api/faucet/fund",
    { method: "POST", body: JSON.stringify(body) },
  );

// --- Transactions (read + write) ---
export interface BackendTransaction {
  id?: string;
  user_id?: string;
  encrypted_payload?: string;
  created_at?: string;
}
export const fetchTransactions = (userId: string) =>
  req<{ transactions: BackendTransaction[] }>(`/api/transactions/${encodeURIComponent(userId)}`);
export const postTransaction = (body: { user_id: string; encrypted_payload: string }) =>
  req<{ transaction: BackendTransaction }>("/api/transactions", {
    method: "POST",
    body: JSON.stringify(body),
  });

// --- Stats / relayer / compliance (read) ---
export const fetchStats = () =>
  req<{
    transactionsCount: number;
    notesCommitted: number;
    tvlFormatted: string;
    zkProofsVerified: number;
    network: string;
    status: string;
  }>("/api/stats");
// --- Public smart wallet (OpenZeppelin smart account, passkey-controlled) ---
export interface WalletBirth {
  txHash: string;
  ledger: number;
}

export interface SmartWalletInfo {
  address: string | null;
  /** The transaction that created the wallet (null until recorded). */
  birth: WalletBirth | null;
  /** The user's passkeys that can control an on-chain wallet (ES256), raw P-256 keys. */
  passkeys: { credentialId: string; publicKey: string; deviceName: string | null }[];
  config: {
    accountWasmHash: string;
    webauthnVerifier: string;
    ed25519Verifier: string;
    deployer: string;
    usdcSac: string;
    xlmSac: string;
    networkPassphrase: string;
  };
}
export const getSmartWallet = () => req<SmartWalletInfo>("/api/smart-wallet");
let ownWallet: Promise<string | null> | null = null;
/** The user's public wallet address (cached per page load); null if none or unavailable. */
export function ownWalletAddress(): Promise<string | null> {
  ownWallet ??= getSmartWallet()
    .then((info) => info.address)
    .catch(() => {
      ownWallet = null;
      return null;
    });
  return ownWallet;
}
/** Records the wallet's creation transaction; the server checks it on-chain. */
export const postSmartWalletBirth = (txHash: string) =>
  req<{ birth: WalletBirth }>("/api/smart-wallet/birth", { method: "POST", body: JSON.stringify({ txHash }) });
/** Short-lived token for the sponsored relayer (smart-account-kit cannot send cookies). */
export const getSmartWalletRelayToken = () =>
  req<{ token: string; expiresAt: number }>("/api/smart-wallet/relay-token", { method: "POST" });

// --- Private pool with real proofs (SPP): the backend pays for transfers and withdrawals ---
export const getZkRelayer = () => req<{ address: string }>("/api/zk/relayer");
/** The relayer signs only a transact call to Starlit's pools; needs a fresh passkey/PIN confirmation. */
export const signWithZkRelayer = (xdr: string, leaseId: string | null = null) =>
  req<{ signedTxXdr: string }>("/api/zk/relayer/sign", { method: "POST", body: JSON.stringify({ xdr, leaseId }) });

/** A channel account for one payment, so many people can pay at once (null leaseId: the relayer itself). */
export const leaseZkChannel = () =>
  req<{ leaseId: string | null; address: string; expiresAt?: number }>("/api/zk/relayer/lease", { method: "POST", body: "{}" });
export const releaseZkChannel = (leaseId: string) =>
  req<{ released: boolean }>("/api/zk/relayer/release", { method: "POST", body: JSON.stringify({ leaseId }) });

export interface ZkKeys {
  noteKey: string;
  encryptionKey: string;
  /** SEP-53 signature of both keys by the user's wallet key, base64. */
  signature: string;
}
export const publishZkKeys = (keys: ZkKeys) =>
  req<{ keys: { noteKey: string; encryptionKey: string } }>("/api/zk/keys", { method: "PUT", body: JSON.stringify(keys) });
export const lookupZkKeys = (username: string) =>
  req<{ keys: ZkKeys & { username: string; stellarAddress: string } }>(`/api/zk/keys/${encodeURIComponent(username)}`);

/** A payment the gateway received for this user that their device still has to deposit privately. */
export interface ZkCredit {
  id: string;
  amount: string;
  asset: "XLM" | "USDC";
  status: "credited" | "claiming";
  receivedAt: string;
}
export const fetchZkDeposits = () => req<{ gateway: string; deposits: ZkCredit[] }>("/api/zk/deposits");
export const signZkDeposit = (id: string, xdr: string) =>
  req<{ signedTxXdr: string }>("/api/zk/deposits/sign", { method: "POST", body: JSON.stringify({ id, xdr }) });

export const relayerHealth = () => req<{ status: string; address: string; balanceXlm: number }>("/api/relayer/health");
export const fetchGatewayAddress = () => req<{ address: string }>("/api/gateway/address");
export const notifyGatewayDeposit = (txHash: string) =>
  req<{
    status: string;
    processed?: boolean;
    reason?: string;
    operations?: Array<{
      processed: boolean;
      reason?: string;
      amount: number;
      asset: string;
      commitment: string;
      contractTxHash: string;
    }>;
  }>("/api/gateway/deposit", {
    method: "POST",
    body: JSON.stringify({ txHash }),
  });

export const complianceCheck = (address: string) =>
  req<{ address: string; blocked: boolean; status: string }>(
    `/api/compliance/check/${encodeURIComponent(address)}`,
  );

// --- Closed beta ("Founding Testers") ---------------------------------------
export type BetaPersona = "freelancer" | "business" | "crypto" | "developer" | "other";
export interface BetaApplicationInput {
  name: string;
  email: string;
  x_handle?: string;
  telegram_handle?: string;
  persona: BetaPersona;
  reason: string;
  captchaToken?: string;
}
export interface BetaApplication {
  id: string;
  name: string;
  email: string;
  x_handle: string | null;
  telegram_handle: string | null;
  persona: BetaPersona;
  reason: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  reviewed_at: string | null;
}
export interface BetaInvite {
  code: string;
  kind: "group" | "golden";
  label: string | null;
  max_uses: number;
  uses: number;
  revoked_at: string | null;
  created_at: string;
}

export const fetchBetaConfig = () => req<{ inviteOnly: boolean }>("/api/beta/config");
/** After Google sign-in: can this email sign up without an invite code? */
export const fetchBetaAccess = (emailProof: string) =>
  req<{ inviteOnly: boolean; approved: boolean }>("/api/beta/access", { headers: { "X-Supabase-Auth": emailProof } });
export const applyToBeta = (body: BetaApplicationInput) =>
  req<{ received: true; statusToken: string | null }>("/api/beta/apply", { method: "POST", body: JSON.stringify(body) });
export const fetchBetaStatus = (token: string) =>
  req<{ name: string; status: BetaApplication["status"]; email: string | null; telegramUrl: string | null }>(
    `/api/beta/status/${encodeURIComponent(token)}`
  );
export const fetchBetaMe = () => req<{ admin: boolean; tickets: { code: string; used: boolean }[] }>("/api/beta/me");

export const listBetaApplications = (status?: BetaApplication["status"]) =>
  req<{ applications: BetaApplication[]; counts: Record<BetaApplication["status"], number> }>(`/api/beta/admin/applications${status ? `?status=${status}` : ""}`);
export const approveBetaApplication = (id: string) =>
  req<{ application: BetaApplication; emailed: boolean }>(`/api/beta/admin/applications/${id}/approve`, { method: "POST", body: "{}" });
export const approveAllBetaApplications = () =>
  req<{ approved: number; emailed: number }>("/api/beta/admin/applications/approve-all", { method: "POST", body: "{}" });
export const rejectBetaApplication = (id: string) =>
  req<{ application: BetaApplication }>(`/api/beta/admin/applications/${id}/reject`, { method: "POST", body: "{}" });
export const listGroupInvites = () => req<{ invites: BetaInvite[] }>("/api/beta/admin/invites");
export const createGroupInvite = (label: string, maxUses: number) =>
  req<{ invite: BetaInvite }>("/api/beta/admin/invites", { method: "POST", body: JSON.stringify({ label, maxUses }) });
export const revokeGroupInvite = (code: string) =>
  req<{ ok: true }>(`/api/beta/admin/invites/${encodeURIComponent(code)}/revoke`, { method: "POST", body: "{}" });
