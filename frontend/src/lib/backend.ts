// Typed client for the starlit-pay backend (Express :3001 / onrender).
// Preserves every read/write the old JSX frontend used.

const DEFAULT_LOCAL = "http://localhost:3001";
const DEFAULT_REMOTE = "https://starlit-pay.onrender.com";

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
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BACKEND_URL}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
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
  user: BackendUser;
  token: string;
}

// --- Auth / users (read + write) ---
export const login = (email: string) =>
  req<AuthResponse>("/api/auth/login", { method: "POST", body: JSON.stringify({ email }) });

export const register = (body: {
  email: string;
  username: string;
  identity_commitment: string;
  public_encryption_key: string;
  display_name?: string;
  avatar_url?: string;
  stellar_address?: string;
}) => req<AuthResponse>("/api/users/register", { method: "POST", body: JSON.stringify(body) });

export const lookupUser = (username: string) =>
  req<{ user: BackendUser }>(`/api/users/lookup/${encodeURIComponent(username.replace(/^@/, ""))}`);

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

// --- Shielded notes (read + write) ---
export interface ShieldedNote {
  commitment: string;
  encrypted_note?: string;
  recipient_viewing_key?: string;
  status?: string;
  root?: string;
  ledger?: number;
}
export const fetchNotes = (viewingKey: string, timestamp: string, signature: string) =>
  req<{ notes: ShieldedNote[] }>(
    `/api/notes/${encodeURIComponent(viewingKey)}?timestamp=${encodeURIComponent(timestamp)}&signature=${encodeURIComponent(signature)}`,
  );
export const postNote = (body: { commitment: string; encrypted_note: string; recipient_viewing_key: string }) =>
  req<{ note: ShieldedNote }>("/api/notes", { method: "POST", body: JSON.stringify(body) });
export const spendNote = (body: { commitment: string; timestamp: string; signature: string }) =>
  req<{ success: boolean }>("/api/notes/spend", { method: "POST", body: JSON.stringify(body) });

// --- Faucet (read + write) ---
export const faucetStatus = (viewingKey: string) =>
  req<{ canClaim: boolean; remainingMs: number; nextClaimAt?: string }>(
    `/api/faucet/status/${encodeURIComponent(viewingKey)}`,
  );
export const faucetFund = (body: { viewingKey: string; depositMemo?: string; timestamp?: string; signature?: string }) =>
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
export const relayerHealth = () => req<{ status: string; address: string; balanceXlm: number }>("/api/relayer/health");
export const complianceCheck = (address: string) =>
  req<{ address: string; blocked: boolean; status: string }>(
    `/api/compliance/check/${encodeURIComponent(address)}`,
  );
