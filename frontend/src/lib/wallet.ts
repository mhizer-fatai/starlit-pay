// Wallet display helpers: prices, the activity feed built from the user's
// transaction records and private-pool notes (see privateWallet), statements.

import { fetchTransactions, type BackendTransaction } from "@/lib/backend";

// Live prices come from usePrices()/fetchPrices() in lib/prices.ts. There is
// deliberately no static fallback: an unknown price stays unknown (null).
export interface PriceTable {
  USDC: number;
  XLM: number | null;
}

/** USD value of an amount, or null when that asset has no live price. */
export function assetToUsd(asset: string, amount: number, prices: PriceTable): number | null {
  const upper = asset.toUpperCase();
  if (upper === "USDC") return amount * prices.USDC;
  if (upper === "XLM") return prices.XLM === null ? null : amount * prices.XLM;
  return 0;
}

export interface BalanceNote {
  commitment: string;
  amount: number;
  asset: string;
  createdAt: number;
  sender?: string;
  ledger?: number;
  /** Already spent (kept for history only; never counted or spendable). */
  spent?: boolean;
}

export interface PrivateBalances {
  usdc: number;
  xlm: number;
  notes: BalanceNote[];
}

export interface DecodedTx {
  to?: string;
  toUsername?: string;
  sender?: string;
  amount?: number;
  asset?: string;
  hash?: string;
  at?: string;
  /** Set on moves between the user's own private and public balances. */
  transfer?: Transfer;
  /** "send", "withdraw", "deposit" (public to private), or "arrival" (a gateway payment this device deposited). */
  type?: string;
  /** Real-ZK pools: tree positions of the notes this transaction created (change, deposits). */
  leaves?: number[];
}

export type Transfer = "to-public" | "to-private";

/** Decodes the base64-JSON payloads written by the Send flow. */
export function decodeTransactionPayload(encryptedPayload: string): DecodedTx | null {
  try {
    const obj = JSON.parse(atob(encryptedPayload)) as {
      to?: unknown;
      toUsername?: unknown;
      sender?: unknown;
      amount?: unknown;
      asset?: unknown;
      hash?: unknown;
      at?: unknown;
      transfer?: unknown;
      type?: unknown;
      leaves?: unknown;
    };
    if (obj && typeof obj === "object") {
      return {
        to: typeof obj.to === "string" ? obj.to : undefined,
        toUsername: typeof obj.toUsername === "string" ? obj.toUsername : undefined,
        sender: typeof obj.sender === "string" ? obj.sender : undefined,
        amount: typeof obj.amount === "number" && Number.isFinite(obj.amount) ? obj.amount : undefined,
        asset: typeof obj.asset === "string" ? obj.asset : undefined,
        hash: typeof obj.hash === "string" ? obj.hash : undefined,
        at: typeof obj.at === "string" ? obj.at : undefined,
        transfer: obj.transfer === "to-public" || obj.transfer === "to-private" ? obj.transfer : undefined,
        type: typeof obj.type === "string" ? obj.type : undefined,
        leaves: Array.isArray(obj.leaves) && obj.leaves.every((n) => Number.isInteger(n)) ? (obj.leaves as number[]) : undefined,
      };
    }
  } catch {
    /* opaque/legacy-encrypted payload */
  }
  return null;
}

export async function loadUserTransactions(userId: string): Promise<BackendTransaction[]> {
  const res = await fetchTransactions(userId);
  return res.transactions ?? [];
}

/** "1,156,908.27" style grouping with exactly 2 decimals. */
export function formatGrouped(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Splits a USD value into dollars/cents parts for the $X<sup>YY</sup> display. */
export function splitDollarsCents(value: number): { dollars: string; cents: string } {
  const [dollars, cents] = formatGrouped(value).split(".");
  return { dollars: dollars ?? "0", cents: cents ?? "00" };
}

/** Makes a display name filename-safe: "Timothy Bayode" → "Timothy-Bayode". */
export function slugifyName(name: string): string {
  const clean = name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-_]+/g, "");
  return clean || "user";
}

/** Unpadded local date stamp: 6-10-2026. */
export function fileDateStamp(date: Date = new Date()): string {
  return `${date.getMonth() + 1}-${date.getDate()}-${date.getFullYear()}`;
}

/** e.g. Timothy-Bayode-Account-Statement-6-10-2026.pdf */
export function statementFilename(userName: string, ext: string, date: Date = new Date()): string {
  return `${slugifyName(userName)}-Account-Statement-${fileDateStamp(date)}.${ext}`;
}

/** e.g. Timothy-Bayode-Transaction-Receipt-6-10-2026.pdf */
export function receiptFilename(userName: string, date: Date = new Date()): string {
  return `${slugifyName(userName)}-Transaction-Receipt-${fileDateStamp(date)}.pdf`;
}

export interface ActivityItem {
  key: string;
  direction: "in" | "out";
  amount: number;
  asset: string;
  /** Sender (incoming) or recipient (outgoing); may be empty when unknown. */
  party: string;
  date: number;
  reference: string;
  referenceLabel: string;
  hash?: string;
  ledger?: number;
  /** A move between the user's own private balance and public wallet. */
  transfer?: Transfer;
}

/**
 * Merges decrypted shielded-note receipts (incoming) with decoded transaction
 * records (outgoing) into one date-ordered activity feed. Notes you sent to
 * yourself (payment change) are your money coming back, not new receipts, so
 * they are excluded here — balances still count them.
 */
export function buildActivityFeed(
  notes: BalanceNote[],
  txs: BackendTransaction[],
  viewerUsername?: string,
  /** The user's public smart wallet: withdrawals to it are transfers, not payments. */
  ownWalletAddress?: string | null,
): ActivityItem[] {
  const items: ActivityItem[] = [];
  const self = (viewerUsername ?? "").toLowerCase().trim();
  for (const tx of txs) {
    const decoded = tx.encrypted_payload ? decodeTransactionPayload(tx.encrypted_payload) : null;
    if (decoded?.amount === undefined || !decoded.asset) continue;
    // A completed gateway arrival shows once, as its "Deposit" note.
    if (decoded.type === "arrival") continue;
    const transfer: Transfer | undefined =
      decoded.transfer ?? (ownWalletAddress && decoded.to === ownWalletAddress ? "to-public" : undefined);
    items.push({
      key: `tx-${tx.id ?? `${tx.created_at ?? ""}-${decoded.amount}`}`,
      direction: transfer === "to-private" ? "in" : "out",
      transfer,
      amount: decoded.amount,
      asset: decoded.asset,
      party: decoded.toUsername ?? decoded.to ?? "",
      date: tx.created_at ? new Date(tx.created_at).getTime() : 0,
      reference: decoded.hash || tx.id || "",
      referenceLabel: decoded.hash ? "Transaction Hash" : "Record ID",
      hash: decoded.hash,
    });
  }
  for (const note of notes) {
    const sender = (note.sender ?? "").toLowerCase().trim();
    if (self && sender && sender === self) continue;
    items.push({
      key: `note-${note.commitment}`,
      direction: "in",
      amount: note.amount,
      asset: note.asset,
      party: note.sender ?? "",
      date: note.createdAt,
      reference: note.commitment,
      referenceLabel: "Note commitment",
      ledger: note.ledger,
    });
  }
  items.sort((a, b) => b.date - a.date);
  return items;
}

/** Short human label for a counterparty (username, Stellar address, or key). */
export function partyLabel(party: string): string {
  if (!party) return "";
  if (/^G[A-Z0-9]{55}$/.test(party)) return `${party.slice(0, 4)}…${party.slice(-4)}`;
  if (/^[0-9a-fA-F]{20,}$/.test(party)) return `${party.slice(0, 6)}…${party.slice(-4)}`;
  return `@${party.replace(/^@/, "")}`;
}

/** Row title, mirroring the previous frontend's activity labels. */
export function activityTitle(item: ActivityItem): string {
  if (item.transfer === "to-public") return "Transfer to public wallet";
  if (item.transfer === "to-private") return "Transfer from public wallet";
  const label = partyLabel(item.party);
  if (item.direction === "in") {
    if (item.party.toLowerCase() === "deposit") return "Deposit";
    if (!label) return "Received";
    return `Received from ${label}`;
  }
  if (!label) return "Sent";
  return `Sent to ${label}`;
}

export type StatementRange = "last-month" | "last-2-months" | "custom";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Filters a feed to a statement period. Items with unknown dates are kept. */
export function filterFeedByRange(
  feed: ActivityItem[],
  range: StatementRange,
  from?: string,
  to?: string,
): ActivityItem[] {
  const now = Date.now();
  let start = 0;
  let end = now;
  if (range === "last-month") start = now - 30 * DAY_MS;
  else if (range === "last-2-months") start = now - 60 * DAY_MS;
  else {
    if (from) {
      const t = new Date(`${from}T00:00:00`).getTime();
      if (Number.isFinite(t)) start = t;
    }
    if (to) {
      const t = new Date(`${to}T23:59:59`).getTime();
      if (Number.isFinite(t)) end = t;
    }
  }
  return feed.filter((item) => !item.date || (item.date >= start && item.date <= end));
}

export function rangeLabel(range: StatementRange, from?: string, to?: string): string {
  if (range === "last-month") return "Last month";
  if (range === "last-2-months") return "Last 2 months";
  return `${from || "…"} to ${to || "…"}`;
}

function formatDayMonthYear(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Concrete timeline for statements, e.g. "08/05/2026 - 10/05/2026". */
export function statementPeriodLabel(range: StatementRange, from?: string, to?: string): string {
  const now = Date.now();
  if (range === "last-month") return `${formatDayMonthYear(now - 30 * DAY_MS)} - ${formatDayMonthYear(now)}`;
  if (range === "last-2-months")
    return `${formatDayMonthYear(now - 60 * DAY_MS)} - ${formatDayMonthYear(now)}`;
  const parse = (value?: string) => {
    if (!value) return null;
    const t = new Date(`${value}T00:00:00`).getTime();
    return Number.isFinite(t) ? t : null;
  };
  const start = parse(from);
  const end = parse(to);
  return `${start === null ? "…" : formatDayMonthYear(start)} - ${end === null ? "…" : formatDayMonthYear(end)}`;
}

/**
 * Starlit usernames the user has paid, most recent first, without duplicates
 * (from their own transaction records; withdrawals to addresses are skipped).
 */
export function recentStarlitRecipients(txs: BackendTransaction[], limit = 6): string[] {
  const sorted = [...txs].sort(
    (a, b) => (b.created_at ? Date.parse(b.created_at) : 0) - (a.created_at ? Date.parse(a.created_at) : 0)
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tx of sorted) {
    const to = tx.encrypted_payload ? decodeTransactionPayload(tx.encrypted_payload)?.to : undefined;
    if (!to?.startsWith("@")) continue;
    const username = to.slice(1);
    const key = username.toLowerCase();
    if (!username || seen.has(key)) continue;
    seen.add(key);
    out.push(username);
    if (out.length >= limit) break;
  }
  return out;
}
