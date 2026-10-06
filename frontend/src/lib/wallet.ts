// Reads real wallet data from the database: decrypted unspent shielded notes
// for balances, decoded transaction records for activity.

import * as StellarSdk from "@stellar/stellar-sdk";

import { getUnlockedKeys, type SessionUser } from "@/lib/auth";
import {
  fetchNotes,
  fetchTransactions,
  type BackendTransaction,
} from "@/lib/backend";
import { bytesToHex, decryptShieldedNote } from "@/lib/keys";

// Static asset prices in USD (same basis as the previous frontend).
// Live prices come from usePrices()/fetchPrices() in lib/prices.ts, which
// proxy CoinGecko through the backend; this is the offline fallback.
export const PRICES = { USDC: 1, XLM: 0.12 } as const;

export interface PriceTable {
  USDC: number;
  XLM: number;
}

export function assetToUsd(asset: string, amount: number, prices: PriceTable = PRICES): number {
  const upper = asset.toUpperCase();
  if (upper === "USDC") return amount * prices.USDC;
  if (upper === "XLM") return amount * prices.XLM;
  return 0;
}

export interface BalanceNote {
  commitment: string;
  amount: number;
  asset: string;
  createdAt: number;
  sender?: string;
}

export interface PrivateBalances {
  usdc: number;
  xlm: number;
  totalUsd: number;
  notes: BalanceNote[];
}

/**
 * Fetches the user's unspent shielded notes (signed request, verified against
 * the stored stellar address) and decrypts them with the viewing secret key.
 * Returns null when the wallet is locked (no PIN-derived keys in this tab).
 */
export async function loadPrivateBalances(user: SessionUser): Promise<PrivateBalances | null> {
  const keys = getUnlockedKeys();
  if (!keys || !user.public_encryption_key) return null;
  const timestamp = Date.now().toString();
  const keypair = StellarSdk.Keypair.fromSecret(keys.stellar.secretKey);
  const signature = bytesToHex(keypair.sign(Buffer.from(new TextEncoder().encode(timestamp))));
  const { notes } = await fetchNotes(user.public_encryption_key, timestamp, signature);

  const out: PrivateBalances = { usdc: 0, xlm: 0, totalUsd: 0, notes: [] };
  for (const note of notes) {
    if (!note.encrypted_note) continue;
    const decrypted = decryptShieldedNote(note.encrypted_note, keys.viewing.secretKey);
    if (!decrypted || !Number.isFinite(decrypted.amount)) continue;
    const asset = decrypted.asset.toUpperCase();
    if (asset !== "USDC" && asset !== "XLM") continue;
    if (asset === "USDC") out.usdc += decrypted.amount;
    else out.xlm += decrypted.amount;
    out.notes.push({
      commitment: note.commitment,
      amount: decrypted.amount,
      asset,
      createdAt: note.created_at ? new Date(note.created_at).getTime() : Date.now(),
      sender: decrypted.sender,
    });
  }
  out.totalUsd = out.usdc * PRICES.USDC + out.xlm * PRICES.XLM;
  return out;
}

export interface DecodedTx {
  to?: string;
  amount?: number;
  asset?: string;
  at?: string;
}

/** Decodes the base64-JSON payloads written by the Send flow. */
export function decodeTransactionPayload(encryptedPayload: string): DecodedTx | null {
  try {
    const obj = JSON.parse(atob(encryptedPayload)) as {
      to?: unknown;
      amount?: unknown;
      asset?: unknown;
      at?: unknown;
    };
    if (obj && typeof obj === "object") {
      return {
        to: typeof obj.to === "string" ? obj.to : undefined,
        amount: typeof obj.amount === "number" && Number.isFinite(obj.amount) ? obj.amount : undefined,
        asset: typeof obj.asset === "string" ? obj.asset : undefined,
        at: typeof obj.at === "string" ? obj.at : undefined,
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
}

/**
 * Merges decrypted shielded-note receipts (incoming) with decoded transaction
 * records (outgoing) into one date-ordered activity feed.
 */
export function buildActivityFeed(notes: BalanceNote[], txs: BackendTransaction[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const tx of txs) {
    const decoded = tx.encrypted_payload ? decodeTransactionPayload(tx.encrypted_payload) : null;
    if (decoded?.amount === undefined || !decoded.asset) continue;
    items.push({
      key: `tx-${tx.id ?? `${tx.created_at ?? ""}-${decoded.amount}`}`,
      direction: "out",
      amount: decoded.amount,
      asset: decoded.asset,
      party: decoded.to ?? "",
      date: tx.created_at ? new Date(tx.created_at).getTime() : 0,
      reference: tx.id ?? "",
      referenceLabel: "Record ID",
    });
  }
  for (const note of notes) {
    items.push({
      key: `note-${note.commitment}`,
      direction: "in",
      amount: note.amount,
      asset: note.asset,
      party: note.sender ?? "",
      date: note.createdAt,
      reference: note.commitment,
      referenceLabel: "Note commitment",
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
