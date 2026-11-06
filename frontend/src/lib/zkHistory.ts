// History for the real-ZK pools. A pool note doesn't say who created it, so
// the app records, for each transaction it makes, the tree positions ("leaves")
// of the notes that transaction created. A note of the user's at one of those
// positions is their own change or deposit; any other note was sent to them.

import * as StellarSdk from "@stellar/stellar-sdk";

import { horizon, rpc } from "@/lib/stellar";

type GetTransaction = (hash: string) => Promise<StellarSdk.rpc.Api.GetTransactionResponse>;

/** Leaf positions of the notes created by these (confirmed) pool transactions. */
export async function createdLeaves(hashes: string[], getTransaction: GetTransaction = (h) => rpc.getTransaction(h)): Promise<number[]> {
  const leaves: number[] = [];
  for (const hash of hashes) {
    const tx = await getTransaction(hash);
    if (tx.status !== "SUCCESS") continue;
    for (const operationEvents of tx.events?.contractEventsXdr ?? []) {
      for (const event of operationEvents) {
        const body = event.body().v0();
        if (StellarSdk.scValToNative(body.topics()[0]) !== "new_commitment_event") continue;
        leaves.push(Number(StellarSdk.scValToNative(body.data()).index));
      }
    }
  }
  return leaves;
}

/** Best effort: history is a nicety, never a reason to fail a payment. */
export async function createdLeavesOrNone(hashes: string[]): Promise<number[]> {
  try {
    return await createdLeaves(hashes);
  } catch (err) {
    console.warn("Could not read the notes a payment created:", err);
    return [];
  }
}

const closeTimes = new Map<number, Promise<number>>();

/** When a ledger closed (ms). Horizon keeps ledger headers far longer than RPC keeps events. */
export function ledgerTime(ledger: number): Promise<number> {
  let time = closeTimes.get(ledger);
  if (!time) {
    time = horizon
      .ledgers()
      .ledger(ledger)
      .call()
      .then((record) => Date.parse((record as unknown as { closed_at: string }).closed_at));
    time.catch(() => closeTimes.delete(ledger));
    closeTimes.set(ledger, time);
  }
  return time;
}

/** "XLM:12": a leaf position is unique within one pool's tree. */
export const leafKey = (asset: string, leaf: number) => `${asset.toUpperCase()}:${leaf}`;
