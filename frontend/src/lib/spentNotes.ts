import * as StellarSdk from "@stellar/stellar-sdk";

import { spendNote } from "@/lib/backend";
import { NETWORK_PASSPHRASE, SHIELDED_POOL_CONTRACT_ID, rpc } from "@/lib/stellar";
import { calculateNullifier } from "@/lib/zk";

// A note is spent once its nullifier is recorded by the pool. The app also
// tells the backend after each payment, but a tab closed at the wrong moment
// leaves the note marked unspent: the balance then counts money that is gone,
// and the next payment fails. So the wallet checks its own nullifiers with the
// pool directly. It asks the chain, not the Starlit backend, so the backend
// never learns which nullifier belongs to which note.

export type NullifierCheck = (nullifierHex: string) => Promise<boolean>;

export const isNullifierSpentOnChain: NullifierCheck = async (nullifierHex) => {
  // A read-only simulation: any source account works, nothing is submitted.
  const source = new StellarSdk.Account(StellarSdk.Keypair.random().publicKey(), "0");
  const tx = new StellarSdk.TransactionBuilder(source, { fee: "100", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(
      new StellarSdk.Contract(SHIELDED_POOL_CONTRACT_ID).call(
        "is_nullifier_spent",
        StellarSdk.nativeToScVal(Buffer.from(nullifierHex, "hex"), { type: "bytes" }),
      ),
    )
    .setTimeout(30)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(sim) || !sim.result) throw new Error("Could not read nullifier status");
  return StellarSdk.scValToNative(sim.result.retval) === true;
};

// Spent is permanent, so a note found spent is never asked about again.
const knownSpent = new Set<string>();

interface NoteWithSecret {
  commitment: string;
  secret: string;
}

/** Commitments of these notes the pool has already spent. A note that can't be checked counts as unspent. */
export async function spentOnChain(notes: NoteWithSecret[], check: NullifierCheck = isNullifierSpentOnChain): Promise<Set<string>> {
  const spent = new Set<string>();
  await Promise.all(
    notes.map(async (note) => {
      if (knownSpent.has(note.commitment)) {
        spent.add(note.commitment);
        return;
      }
      try {
        if (await check(await calculateNullifier(note.secret, note.commitment))) {
          knownSpent.add(note.commitment);
          spent.add(note.commitment);
        }
      } catch {
        /* unknown for now: the next load asks again */
      }
    }),
  );
  return spent;
}

/** Corrects the backend's record of notes found spent on chain (signed-in session). */
export function reportSpent(commitments: Iterable<string>): void {
  for (const commitment of commitments) void spendNote({ commitment }).catch(() => undefined);
}

/** Drops notes the pool has already spent, and corrects their backend record. */
export async function withoutSpentOnChain<T extends NoteWithSecret>(notes: T[], check?: NullifierCheck): Promise<T[]> {
  const spent = await spentOnChain(notes, check);
  reportSpent(spent);
  return notes.filter((note) => !spent.has(note.commitment));
}
