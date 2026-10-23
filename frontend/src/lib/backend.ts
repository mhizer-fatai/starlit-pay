// Typed client for the starlit-pay backend (Express :3001 / onrender).
// Preserves every read/write the old JSX frontend used.

const DEFAULT_LOCAL = "http://localhost:3001";
// Same site as starlitpay.xyz, so session cookies are first-party (Safari/iOS block cross-site cookies).
const DEFAULT_REMOTE = "https://api.starlitpay.xyz";

export const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ||
  (typeof window !== "undefined" && window.location.hostname === "localhost"
    ? DEFAULT_LOCAL
    : DEFAULT_REMOTE);

const JWT_KEY = "starlit_jwt";
const USER_KEY = "starlit_user";

export function getToken(): string | null {
  try {
    return localStorage.getItem(JWT_KEY);
  } catch {
    return null;
  }
}
export function setSession(token: string, user: unknown) {
  try {
    localStorage.setItem(JWT_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}
export function clearSession() {
  try {
    localStorage.removeItem(JWT_KEY);
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
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit, auth = false): Promise<T> {
  // X-Requested-With is the CSRF header the backend requires when a request is
  // authenticated by the passkey session cookie (credentials: "include").
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Requested-With": "starlit" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { ...headers, ...init?.headers },
  });
  if (!res.ok) {
    let msg = `Backend ${res.status}: ${path}`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      msg = body.error || body.message || msg;
    } catch {
      /* non-JSON */
    }
    throw new BackendError(res.status, msg);
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
  token?: string;
}

// --- Auth / users (read + write) ---
// Lookup mode (no identity_commitment): returns { exists, user? } WITHOUT a
// token so a JWT is never issued before the PIN is verified.
// Unlock mode (with identity_commitment): backend verifies the PIN-derived
// commitment and only then returns { exists: true, user, token }.
export const login = (email: string, identity_commitment?: string) =>
  req<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(
      identity_commitment ? { email, identity_commitment } : { email },
    ),
  });

export const register = (body: {
  email: string;
  username: string;
  identity_commitment: string;
  public_encryption_key: string;
  display_name?: string;
  avatar_url?: string;
  stellar_address?: string;
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
  req<{ user: BackendUser }>("/api/users/me", { method: "PATCH", body: JSON.stringify(body) }, true);

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
  req<{ settings: UserSettings }>("/api/users/me/settings", {}, true);
export const updateSettings = (body: SettingsUpdate) =>
  req<{ settings: UserSettings }>(
    "/api/users/me/settings",
    { method: "PATCH", body: JSON.stringify(body) },
    true,
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
}) => req<{ link: PaymentLink }>("/api/payment-links", { method: "POST", body: JSON.stringify(body) }, true);

export const fetchPaymentLink = (commitment: string) =>
  req<{ link: PaymentLink & { creator?: BackendUser } }>(
    `/api/payment-links/${encodeURIComponent(commitment)}`,
  );
export const claimPaymentLink = (commitment: string, txHash?: string) =>
  req<{ link: PaymentLink }>(`/api/payment-links/${encodeURIComponent(commitment)}/claim`, {
    method: "POST",
    body: JSON.stringify({ txHash }),
  });

// --- Shielded notes (read + write) ---
export interface ShieldedNote {
  commitment: string;
  encrypted_note?: string;
  recipient_viewing_key?: string;
  status?: string;
  root?: string;
  ledger?: number;
  created_at?: string;
}
export const fetchNotes = (viewingKey: string, timestamp?: string, signature?: string, opts: { includeSpent?: boolean } = {}) => {
  const params = new URLSearchParams();
  if (timestamp && signature) {
    params.set("timestamp", timestamp);
    params.set("signature", signature);
  }
  // History only: spent notes are never spendable or counted in balances.
  if (opts.includeSpent) params.set("include", "spent");
  const qs = params.toString();
  const query = qs ? `?${qs}` : "";
  return req<{ notes: ShieldedNote[] }>(`/api/notes/${encodeURIComponent(viewingKey)}${query}`, undefined, true);
};

export const postNote = (body: { commitment: string; encrypted_note: string; recipient_viewing_key: string }) =>
  req<{ note: ShieldedNote }>("/api/notes", { method: "POST", body: JSON.stringify(body) });

export const spendNote = (body: { commitment: string; timestamp?: string; signature?: string }) =>
  req<{ success: boolean }>("/api/notes/spend", { method: "POST", body: JSON.stringify(body) }, true);


// --- Faucet (read + write) ---
export const faucetStatus = (viewingKey: string) =>
  req<{ canClaim: boolean; remainingMs: number; nextClaimAt?: string }>(
    `/api/faucet/status/${encodeURIComponent(viewingKey)}`,
  );
export const faucetFund = (body: { viewingKey: string; depositMemo?: string; timestamp?: string; signature?: string; captchaToken?: string; asset?: string }) =>
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
    poolContract: string;
    networkPassphrase: string;
  };
}
export const getSmartWallet = () => req<SmartWalletInfo>("/api/smart-wallet", undefined, true);
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
  req<{ birth: WalletBirth }>("/api/smart-wallet/birth", { method: "POST", body: JSON.stringify({ txHash }) }, true);
/** Short-lived token for the sponsored relayer (smart-account-kit cannot send cookies). */
export const getSmartWalletRelayToken = () =>
  req<{ token: string; expiresAt: number }>("/api/smart-wallet/relay-token", { method: "POST" }, true);

/** A Merkle root the shielded pool currently accepts (checked on-chain by the backend). */
export const getPoolRoot = () => req<{ root: string }>("/api/pool/root");

export const relayerHealth = () => req<{ status: string; address: string; balanceXlm: number }>("/api/relayer/health");
export const fetchGatewayAddress = () => req<{ address: string }>("/api/gateway/address");
export const notifyGatewayDeposit = (txHash: string) =>
  req<{
    status: string;
    processed?: boolean;
    reason?: string;
    operations?: Array<{
      processed: boolean;
      amount: number;
      asset: string;
      commitment: string;
      contractTxHash: string;
    }>;
  }>("/api/gateway/deposit", {
    method: "POST",
    body: JSON.stringify({ txHash }),
  });

// Sends the generated statement file to the user's own inbox (server-side).
export const emailStatement = (body: {
  filename: string;
  mime: string;
  contentBase64: string;
  subject?: string;
}) =>
  req<{ sent: boolean; to: string }>(
    "/api/statements/email",
    { method: "POST", body: JSON.stringify(body) },
    true,
  );
export const complianceCheck = (address: string) =>
  req<{ address: string; blocked: boolean; status: string }>(
    `/api/compliance/check/${encodeURIComponent(address)}`,
  );

export interface RelayerTransferPayload {
  proof: string;
  nullifier_1: string;
  nullifier_2: string;
  output_commitment_1: string;
  encrypted_note_1: string;
  output_commitment_2: string;
  encrypted_note_2: string;
  root: string;
}

export const submitRelayerTransfer = (body: RelayerTransferPayload) =>
  req<{ success: boolean; hash: string; ledger?: number }>(
    "/api/relayer/transfer",
    { method: "POST", body: JSON.stringify(body) },
    true // legacy accounts authorise with their token; passkey sessions via cookie
  );

export interface RelayerWithdrawPayload {
  proof: string;
  nullifier_1: string;
  nullifier_2: string;
  recipient: string;
  token: string;
  amount: number;
  root: string;
  change_commitment: string;
  encrypted_change_note: string;
}

export const submitRelayerWithdraw = (body: RelayerWithdrawPayload) =>
  req<{ success: boolean; hash: string; ledger?: number }>(
    "/api/relayer/withdraw",
    { method: "POST", body: JSON.stringify(body) },
    true
  );

