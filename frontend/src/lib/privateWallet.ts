// The app's private balance and payments on the real-proof pools (SPP).
// Turned on with VITE_PRIVATE_POOL=spp; until existing balances are moved
// over (phase 5), the app keeps using the older pool.

import { getUnlockedKeys, getUser, type SessionUser } from "@/lib/auth";
import { fetchZkDeposits, postTransaction, signZkDeposit, type BackendTransaction, type ZkCredit } from "@/lib/backend";
import { decodeTransactionPayload, loadPrivateBalances, loadUserTransactions, type BalanceNote, type PrivateBalances } from "@/lib/wallet";
import { createdLeavesOrNone, ledgerTime, leafKey } from "@/lib/zkHistory";
import { openPrivateSession, recipientKeys, type PoolAsset, type SessionOptions } from "@/lib/privatePool";

export const zkPoolEnabled = () => import.meta.env.VITE_PRIVATE_POOL === "spp";

const DECIMALS = 7; // XLM and USDC on Stellar
const UNIT = 10n ** BigInt(DECIMALS);

/** "1.5" → 15000000n. Throws on more than 7 decimals or anything that isn't a positive amount. */
export function toBaseUnits(amount: string): bigint {
  const trimmed = amount.trim();
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(trimmed);
  if (!match) throw new Error("Enter an amount with at most 7 decimal places.");
  const value = BigInt(match[1]) * UNIT + BigInt((match[2] ?? "").padEnd(DECIMALS, "0"));
  if (value <= 0n) throw new Error("Enter an amount greater than 0.");
  return value;
}

export const fromBaseUnits = (value: bigint) => Number(value) / Number(UNIT);

function ownerSecret(): string {
  const secret = getUnlockedKeys()?.stellar.secretKey;
  if (!secret) throw new Error("Unlock your wallet first.");
  return secret;
}

export interface ZkBalances {
  xlm: number;
  usdc: number;
}

/** Private balances, after catching up with the chain. Null when the wallet is locked. */
export async function loadZkBalances(options?: SessionOptions): Promise<ZkBalances | null> {
  const secret = getUnlockedKeys()?.stellar.secretKey;
  if (!secret) return null;
  const session = await openPrivateSession(secret, options);
  await session.sync();
  const [xlm, usdc] = await Promise.all((["XLM", "USDC"] as PoolAsset[]).map(async (asset) => (await session.pool(asset)).balance()));
  return { xlm: fromBaseUnits(xlm), usdc: fromBaseUnits(usdc) };
}

/** The balances and notes the app shows, from whichever pool is in use. */
export async function loadAppBalances(user: SessionUser, options?: SessionOptions): Promise<PrivateBalances | null> {
  if (!zkPoolEnabled()) return loadPrivateBalances(user);
  const balances = await loadZkBalances(options);
  if (!balances) return null;
  const notes = await loadZkNotes(user, options).catch((err) => {
    console.warn("Could not load private-payment history:", err);
    return [];
  });
  return { ...balances, notes };
}

/**
 * The user's notes in the real-ZK pools, for activity. A note at a position
 * one of their own recorded transactions created is change (marked as theirs,
 * so the feed leaves it out) or a deposit; any other note was sent to them.
 * Pool notes don't say who sent them, so those show as "Received".
 */
export async function loadZkNotes(user: SessionUser, options?: SessionOptions, txs?: BackendTransaction[]): Promise<BalanceNote[]> {
  const records = txs ?? (await loadUserTransactions(user.id));
  const own = new Map<string, "change" | "deposit">();
  for (const record of records) {
    const decoded = record.encrypted_payload ? decodeTransactionPayload(record.encrypted_payload) : null;
    if (!decoded?.leaves || !decoded.asset) continue;
    for (const leaf of decoded.leaves) own.set(leafKey(decoded.asset, leaf), decoded.type === "arrival" ? "deposit" : "change");
  }

  const session = await openPrivateSession(ownerSecret(), options);
  const notes: BalanceNote[] = [];
  for (const asset of ["XLM", "USDC"] as PoolAsset[]) {
    for (const note of await (await session.pool(asset)).notes()) {
      const kind = own.get(leafKey(asset, note.leafIndex));
      notes.push({
        commitment: note.id,
        amount: fromBaseUnits(BigInt(note.amount)),
        asset,
        createdAt: await ledgerTime(note.createdAtLedger).catch(() => 0),
        sender: kind === "deposit" ? "deposit" : kind === "change" ? user.username : undefined,
        ledger: note.createdAtLedger,
        spent: note.spent,
      });
    }
  }
  return notes;
}

/** The pools' smallest deposit: a gateway payment below it can't be added to a private balance. */
export const MIN_DEPOSIT = 0.1;
/** The pools' fee on every private transaction, deposits included. */
export const POOL_FEE = 0.01;

/**
 * Opens the private session, which publishes the user's signed keys so others
 * can pay them by username. Resolves with whether that worked.
 */
export async function ensureReceivable(options?: SessionOptions): Promise<boolean> {
  const session = await openPrivateSession(ownerSecret(), options);
  return session.keysPublished;
}

export type Recipient = { kind: "user"; username: string } | { kind: "address"; address: string };

export interface ZkPaymentResult {
  hashes: string[];
  /** Pool fees paid, in token units (one per on-chain step). */
  fees: number;
  /** Tree positions of the notes the payment created (record them: see loadZkNotes). */
  leaves: number[];
}

export class PartialPaymentError extends Error {
  constructor(
    message: string,
    readonly hashes: string[]
  ) {
    super(message);
  }
}

const PROGRESS_EVENT = "stellar-private-payments:tx-progress";
const STAGES: Record<string, string> = {
  prove: "Securing your payment",
  sync_wait: "Catching up with the network",
  simulate: "Checking the payment",
  sign: "Authorizing",
  submit: "Sending",
};

/** Plain-language progress for the SDK's stages ("Securing your payment (step 1 of 2)…"). */
export function progressMessage(detail: { stage: string; current?: number; total?: number }): string {
  const label = STAGES[detail.stage] ?? "Working";
  const step = detail.total && detail.total > 1 ? ` (step ${detail.current} of ${detail.total})` : "";
  return `${label}${step}…`;
}

/**
 * Pays a Starlit user privately, or withdraws to a public Stellar address.
 * The proof is made on this device; Starlit's payer pays the network fee.
 * The caller confirms the payment (passkey/PIN) first: the payer requires it.
 */
export async function sendZkPayment(
  { asset, amount, to }: { asset: PoolAsset; amount: string; to: Recipient },
  onProgress: (message: string) => void = () => {},
  options?: SessionOptions
): Promise<ZkPaymentResult> {
  const value = toBaseUnits(amount);
  onProgress("Getting ready…");
  const session = await openPrivateSession(ownerSecret(), options);
  await session.sync();
  const pool = await session.pool(asset);

  const [balance, maxSpend] = await Promise.all([pool.balance(), pool.maxSpend()]);
  if (value > maxSpend) {
    throw new Error(
      balance === 0n
        ? `You have no private ${asset} yet.`
        : `You can send at most ${fromBaseUnits(maxSpend)} ${asset} (your balance is ${fromBaseUnits(balance)}, less the privacy fee).`
    );
  }
  const keys = to.kind === "user" ? await recipientKeys(to.username) : null;
  const estimate = await pool.estimate(value);

  const result = await withProgress(onProgress, () =>
    keys ? pool.transferToKeys(keys.noteKey, keys.encryptionKey, value) : pool.withdraw(value, (to as { address: string }).address)
  );
  const hashes = [...result.hashes];
  if (result.status === "ok") return { hashes, fees: fromBaseUnits(BigInt(estimate.fees)), leaves: await createdLeavesOrNone(hashes) };
  if (hashes.length) {
    throw new PartialPaymentError(`Only part of the payment went through (${hashes.length} step${hashes.length > 1 ? "s" : ""}). Check your balance, then send the rest.`, hashes);
  }
  throw new Error(result.message || "The payment didn't go through. Nothing was sent.");
}

/** Forwards the SDK's progress events while `run` is in flight. */
async function withProgress<T>(onProgress: (message: string) => void, run: () => Promise<T>): Promise<T> {
  const listener = (event: Event) => onProgress(progressMessage((event as CustomEvent).detail));
  window.addEventListener(PROGRESS_EVENT, listener);
  try {
    return await run();
  } finally {
    window.removeEventListener(PROGRESS_EVENT, listener);
  }
}

// --- Arrivals: payments the gateway received for this user (faucet, or any
// wallet paying their deposit memo). This device proves each deposit and the
// gateway signs it as the depositor, so the user's wallet never appears on-chain.

export interface Arrivals {
  xlm: number;
  usdc: number;
}

interface ArrivalDeps {
  fetchCredits?: typeof fetchZkDeposits;
  signDeposit?: typeof signZkDeposit;
  /** Keeps the completed deposit in the user's history (the notes it created). */
  record?: (entry: { type: "arrival"; amount: number; asset: string; hash?: string; leaves: number[]; at: string }) => Promise<unknown>;
  options?: SessionOptions;
}

async function recordForUser(entry: object) {
  const me = await getUser();
  if (me) await postTransaction({ user_id: me.id, encrypted_payload: btoa(JSON.stringify(entry)) });
}

/** Totals received but not yet in the private balance. */
export async function loadArrivals({ fetchCredits = fetchZkDeposits }: ArrivalDeps = {}): Promise<Arrivals> {
  const { deposits } = await fetchCredits();
  const total = (asset: string) => deposits.filter((d) => d.asset === asset).reduce((sum, d) => sum + Number(d.amount), 0);
  return { xlm: total("XLM"), usdc: total("USDC") };
}

let completing: Promise<number> | null = null;

/**
 * Deposits every arrival into the private balance (about 40 s each), less the
 * pool fee. Resolves with how many completed; one run at a time.
 */
export function completeArrivals(onProgress: (message: string) => void = () => {}, deps: ArrivalDeps = {}): Promise<number> {
  completing ??= runArrivals(onProgress, deps).finally(() => {
    completing = null;
  });
  return completing;
}

async function runArrivals(
  onProgress: (message: string) => void,
  { fetchCredits = fetchZkDeposits, signDeposit = signZkDeposit, record = recordForUser, options }: ArrivalDeps
) {
  let completed = 0;
  const tried = new Set<string>();
  // Credits can arrive while this runs (an old balance still moving): look
  // again after each round, a few times, but never retry one in the same run.
  for (let round = 0; round < MAX_ARRIVAL_ROUNDS; round++) {
    const { gateway, deposits } = await fetchCredits();
    const ready = deposits.filter((d) => d.status === "credited" && !tried.has(d.id));
    if (!ready.length) break;
    ready.forEach((d) => tried.add(d.id));
    completed += await depositCredits(ready, gateway, onProgress, signDeposit, record, options);
  }
  return completed;
}

const MAX_ARRIVAL_ROUNDS = 3;

async function depositCredits(
  ready: ZkCredit[],
  gateway: string,
  onProgress: (message: string) => void,
  signDeposit: typeof signZkDeposit,
  record: NonNullable<ArrivalDeps["record"]>,
  options?: SessionOptions
) {
  const session = await openPrivateSession(ownerSecret(), options);
  await session.sync();

  let completed = 0;
  for (const credit of ready) {
    const signer = { address: async () => gateway, sign: (xdr: string) => signDeposit(credit.id, xdr) };
    const { pool, free } = await session.poolSignedBy(credit.asset, signer);
    try {
      // The pool adds its fee on top, so this pulls exactly the amount received.
      const amount = toBaseUnits(credit.amount) - (await pool.fee());
      if (amount <= 0n) continue;
      onProgress(`Adding ${credit.amount.replace(/\.?0+$/, "")} ${credit.asset} to your private balance…`);
      const result = await withProgress(onProgress, () => pool.deposit(amount));
      if (result.status === "ok") {
        completed++;
        const hashes = [...result.hashes];
        await record({
          type: "arrival",
          amount: fromBaseUnits(amount),
          asset: credit.asset,
          hash: hashes.at(-1),
          leaves: await createdLeavesOrNone(hashes),
          at: new Date().toISOString(),
        }).catch((err) => console.warn("Could not record the deposit:", err));
      } else console.warn(`Arrival ${credit.id} not completed: ${result.message ?? result.status}`);
    } catch (err) {
      // Left as a credit: the next open tries again.
      console.warn(`Arrival ${credit.id} not completed:`, err);
    } finally {
      free();
    }
  }
  return completed;
}
