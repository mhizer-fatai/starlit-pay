// Re-shielding: moves every note the user did not create themselves into a
// fresh note only they can spend.
//
// Whoever creates a note knows its secret, and today the secret alone is
// enough to spend it, so the sender of a payment, the deposit gateway and the
// faucet could all spend the notes they gave you. Moving such notes into
// self-created ones (lib/ownedNotes) removes that ability. It runs on unlock
// and periodically while unlocked; the relayer pays the fees, and nothing is
// asked of the user.

import { fetchNotes } from "@/lib/backend";
import type { DerivedKeys } from "@/lib/keys";
import { getSpendableNotes, type SpendableNote } from "@/lib/notes";
import { isSelfCreated } from "@/lib/ownedNotes";
import { moveNotes, signedTimestamp } from "@/lib/selfTransfer";

const ASSETS = ["XLM", "USDC"] as const;
const INTERVAL_MS = 3 * 60 * 1000;

// One note-spending operation at a time in this tab (re-shield, Send, ...), so
// two of them never pick the same note.
let chain: Promise<unknown> = Promise.resolve();
export function withNoteLock<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

export interface ReshieldContext {
  keys: DerivedKeys;
  username: string;
  /**
   * Whether the server will accept a spend now. Relayer spends need a recent
   * passkey/PIN confirmation, so runs outside that window are skipped (the
   * next unlock or payment confirmation opens it again).
   */
  canSpend?: () => Promise<boolean>;
}

/** Notes that someone else created (so someone else knows their secret). */
export async function findForeignNotes(keys: DerivedKeys) {
  const { timestamp, signature } = signedTimestamp(keys);
  const { notes } = await fetchNotes(keys.viewing.publicKey, timestamp, signature);
  const foreign: Record<string, SpendableNote[]> = {};
  for (const asset of ASSETS) {
    const spendable = getSpendableNotes(notes, keys.viewing.secretKey, asset);
    const checked = await Promise.all(spendable.map(async (n) => ((await isSelfCreated(keys.spendingKey, n)) ? null : n)));
    foreign[asset] = checked.filter((n): n is SpendableNote => n !== null);
  }
  return foreign;
}

/** Moves all foreign notes into self-created ones, two at a time. Returns how many transfers ran. */
export function reshieldIncomingNotes(ctx: ReshieldContext, onProgress?: (message: string) => void): Promise<number> {
  return withNoteLock(async () => {
    const foreign = await findForeignNotes(ctx.keys);
    let moved = 0;
    for (const asset of ASSETS) {
      const notes = foreign[asset];
      while (notes.length > 0) {
        const pair = notes.splice(0, 2) as [SpendableNote] | [SpendableNote, SpendableNote];
        onProgress?.(`Securing incoming ${asset}…`);
        await moveNotes({ notes: pair, asset, from: ctx.keys, to: ctx.keys, username: ctx.username });
        moved += 1;
      }
    }
    return moved;
  });
}

let timer: ReturnType<typeof setInterval> | null = null;
let current: ReshieldContext | null = null;

/** Starts re-shielding for the unlocked wallet: now, then every few minutes. */
export function startAutoReshield(ctx: ReshieldContext) {
  stopAutoReshield();
  current = ctx;
  const run = async () => {
    const ctx = current;
    if (!ctx) return;
    if (ctx.canSpend && !(await ctx.canSpend().catch(() => false))) return;
    await reshieldIncomingNotes(ctx).catch((err) => {
      // Best effort: the next run retries. Funds stay where they are.
      console.warn("Re-shielding paused:", err instanceof Error ? err.message : err);
    });
  };
  void run();
  timer = setInterval(() => void run(), INTERVAL_MS);
}

export function stopAutoReshield() {
  if (timer) clearInterval(timer);
  timer = null;
  current = null;
}
