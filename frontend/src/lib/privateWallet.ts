// The app's private balance and payments on the real-proof pools (SPP).
// Turned on with VITE_PRIVATE_POOL=spp; until existing balances are moved
// over (phase 5), the app keeps using the older pool.

import { getUnlockedKeys, type SessionUser } from "@/lib/auth";
import { fetchZkDeposits, signZkDeposit } from "@/lib/backend";
import { loadPrivateBalances, type PrivateBalances } from "@/lib/wallet";
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

/**
 * The balances the app shows, from whichever pool is in use. On the new pool,
 * notes aren't listed yet: they don't say who sent them, so the user's own
 * change would look like money received.
 */
export async function loadAppBalances(user: SessionUser): Promise<PrivateBalances | null> {
  if (!zkPoolEnabled()) return loadPrivateBalances(user);
  const balances = await loadZkBalances();
  return balances && { ...balances, notes: [] };
}

export type Recipient = { kind: "user"; username: string } | { kind: "address"; address: string };

export interface ZkPaymentResult {
  hashes: string[];
  /** Pool fees paid, in token units (one per on-chain step). */
  fees: number;
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
  if (result.status === "ok") return { hashes, fees: fromBaseUnits(BigInt(estimate.fees)) };
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
  options?: SessionOptions;
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

async function runArrivals(onProgress: (message: string) => void, { fetchCredits = fetchZkDeposits, signDeposit = signZkDeposit, options }: ArrivalDeps) {
  const { gateway, deposits } = await fetchCredits();
  const ready = deposits.filter((d) => d.status === "credited");
  if (!ready.length) return 0;
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
      if (result.status === "ok") completed++;
      else console.warn(`Arrival ${credit.id} not completed: ${result.message ?? result.status}`);
    } catch (err) {
      // Left as a credit: the next open tries again.
      console.warn(`Arrival ${credit.id} not completed:`, err);
    } finally {
      free();
    }
  }
  return completed;
}
