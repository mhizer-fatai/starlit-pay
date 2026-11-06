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

export interface OldBalance {
  xlm: number;
  usdc: number;
}

async function spendable(user: SessionUser, asset: Asset) {
  const viewingSecret = getViewingSecret(user.email);
  if (!viewingSecret || !user.public_encryption_key) return [];
  const { notes } = await fetchNotes(user.public_encryption_key);
  return withoutSpentOnChain(getSpendableNotes(notes, viewingSecret, asset));
}

/** What's still in the older pool for this user (only what can still be moved counts). */
export async function loadOldBalance(user: SessionUser): Promise<OldBalance> {
  const totals = await Promise.all(ASSETS.map(async (asset) => (await spendable(user, asset)).reduce((sum, n) => sum + n.amount, 0)));
  return { xlm: totals[0], usdc: totals[1] };
}

export type MoveResult = { moved: number } | { moved: number; needsConfirmation: true };

/** True for the backend's "confirm with your passkey or PIN first" answer. */
const needsConfirmation = (err: unknown) => err instanceof BackendError && err.status === 401;

/**
 * Withdraws the old notes to the gateway, two at a time. Stops (to ask the
 * user to confirm) when the session needs a fresh passkey/PIN confirmation.
 */
export async function moveOldBalance(user: SessionUser, onProgress: (message: string) => void = () => {}): Promise<MoveResult> {
  const { address: gateway } = await fetchGatewayAddress();
  let moved = 0;
  for (const asset of ASSETS) {
    for (;;) {
      const [first, second] = await spendable(user, asset);
      if (!first) break;
      const amount = Number((first.amount + (second?.amount ?? 0)).toFixed(7));
      if (amount < MIN_DEPOSIT) break;
      onProgress(`Moving ${amount} ${asset} from your old private balance…`);
      try {
        await withdrawFromPool({ user, asset, amount, recipient: gateway, onStatus: onProgress, unrecorded: true });
      } catch (err) {
        if (needsConfirmation(err)) return { moved, needsConfirmation: true };
        throw err;
      }
      moved++;
    }
  }
  return { moved };
}
