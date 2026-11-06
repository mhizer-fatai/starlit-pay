// Moving a user's balance from the older pool to the real-ZK pools (phase 5).
//
// Each step withdraws up to two old notes, whole (no change), to the gateway
// through the relayer. The backend credits it to this user, and the credit is
// then deposited into the new pool like any other arrival (completeArrivals).
// Notes worth less than the new pool's minimum deposit can't be moved.

import { BackendError, fetchGatewayAddress, fetchNotes } from "@/lib/backend";
import { getViewingSecret, type SessionUser } from "@/lib/auth";
import { getSpendableNotes } from "@/lib/notes";
import { withdrawFromPool } from "@/lib/privateWithdraw";
import { withoutSpentOnChain } from "@/lib/spentNotes";
import { MIN_DEPOSIT } from "@/lib/privateWallet";

const ASSETS = ["XLM", "USDC"] as const;
type Asset = (typeof ASSETS)[number];
const RETRY_DELAY_MS = 3000;

export interface OldBalance {
  xlm: number;
  usdc: number;
}

async function spendable(user: SessionUser, asset: Asset, exclude: ReadonlySet<string> = new Set()) {
  const viewingSecret = getViewingSecret(user.email);
  if (!viewingSecret || !user.public_encryption_key) return [];
  const { notes } = await fetchNotes(user.public_encryption_key);
  return (await withoutSpentOnChain(getSpendableNotes(notes, viewingSecret, asset))).filter((n) => !exclude.has(n.commitment));
}

/**
 * What's still in the older pool for this user and can be moved. Less than
 * the new pool's minimum deposit can't move, so it counts as nothing here.
 */
export async function loadOldBalance(user: SessionUser): Promise<OldBalance> {
  const totals = await Promise.all(ASSETS.map(async (asset) => (await spendable(user, asset)).reduce((sum, n) => sum + n.amount, 0)));
  const movable = (total: number) => (total >= MIN_DEPOSIT ? total : 0);
  return { xlm: movable(totals[0]), usdc: movable(totals[1]) };
}

export type MoveResult = { moved: number; needsConfirmation?: true; failed?: true };

/** True for the backend's "confirm with your passkey or PIN first" answer. */
const needsConfirmation = (err: unknown) => err instanceof BackendError && err.status === 401;

/**
 * Withdraws the old notes to the gateway, two at a time. Stops to ask the user
 * to confirm when the session needs a fresh passkey/PIN confirmation; a step
 * that keeps failing (network) stops the move without throwing, so what was
 * already moved can still be deposited. Notes sent in this run are never sent
 * again, even before the database records them as spent.
 */
export async function moveOldBalance(
  user: SessionUser,
  onProgress: (message: string) => void = () => {},
  { retryDelayMs = RETRY_DELAY_MS }: { retryDelayMs?: number } = {}
): Promise<MoveResult> {
  const { address: gateway } = await fetchGatewayAddress();
  const sent = new Set<string>();
  let moved = 0;
  for (const asset of ASSETS) {
    for (;;) {
      const [first, second] = await spendable(user, asset, sent);
      if (!first) break;
      const amount = Number((first.amount + (second?.amount ?? 0)).toFixed(7));
      if (amount < MIN_DEPOSIT) break;
      onProgress(`Moving ${amount} ${asset} from your old private balance…`);
      for (let attempt = 1; ; attempt++) {
        try {
          await withdrawFromPool({ user, asset, amount, recipient: gateway, onStatus: onProgress, unrecorded: true, exclude: sent });
          break;
        } catch (err) {
          if (needsConfirmation(err)) return { moved, needsConfirmation: true };
          console.warn(`Moving old ${asset} failed (attempt ${attempt}):`, err);
          if (attempt === 2) return { moved, failed: true };
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
      sent.add(first.commitment);
      if (second) sent.add(second.commitment);
      moved++;
    }
  }
  return { moved };
}
