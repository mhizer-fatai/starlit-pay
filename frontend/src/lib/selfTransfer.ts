// Spends one or two notes into a single fresh note owned by `owner`, as a
// private send-to-self through the pool (the relayer pays the fee). The new
// note's secret is derived from the owner's spending key, so only the owner
// can spend it. Used by the account upgrade and by re-shielding.

import * as StellarSdk from "@stellar/stellar-sdk";

import { postNote, spendNote, submitRelayerTransfer } from "@/lib/backend";
import { encryptNote } from "@/lib/crypto";
import { bytesToHex, type DerivedKeys } from "@/lib/keys";
import { spendRootFor, type SpendableNote } from "@/lib/notes";
import { selfNoteSecret } from "@/lib/ownedNotes";
import { TOKENS } from "@/lib/stellar";
import { calculateCommitment, generateShieldedPaymentProof } from "@/lib/zk";

const ZERO_COMMITMENT = "0".repeat(64);

/** Proof for the legacy note API: a fresh timestamp signed with the note owner's Stellar key. */
export function signedTimestamp(keys: DerivedKeys) {
  const timestamp = Date.now().toString();
  const keypair = StellarSdk.Keypair.fromSecret(keys.stellar.secretKey);
  return { timestamp, signature: bytesToHex(keypair.sign(Buffer.from(timestamp))) };
}

export async function moveNotes(input: {
  /** One or two unspent notes of the same asset. */
  notes: [SpendableNote] | [SpendableNote, SpendableNote];
  asset: string;
  /** Current owner (its viewing key holds the notes; its Stellar key retires them). */
  from: DerivedKeys;
  /** New owner of the resulting note. */
  to: DerivedKeys;
  /** Shown as the sender inside the new note. */
  username: string;
}): Promise<{ commitment: string; amount: number }> {
  const [input1, input2 = null] = input.notes;
  const tokenAddress = TOKENS[input.asset];
  if (!tokenAddress) throw new Error(`Unsupported asset: ${input.asset}`);
  const amount = input1.amount + (input2?.amount ?? 0);

  // A single input is padded with a zero-value dummy, as in Send.
  const secret2 = input2?.secret ?? bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const commitment2 =
    input2?.commitment ?? (await calculateCommitment(0, input.from.viewing.publicKey, tokenAddress, secret2));

  const { secret, n } = await selfNoteSecret(input.to.spendingKey);
  const commitment = await calculateCommitment(amount, input.to.viewing.publicKey, tokenAddress, secret);
  const enc = encryptNote(amount, input.asset, secret, input.username, input.to.viewing.publicKey, { n });
  const encHex = enc.ephemeralPublicKey + enc.nonce + enc.ciphertext;

  const zk = await generateShieldedPaymentProof(
    input1.secret,
    input1.commitment,
    secret2,
    commitment2,
    input.to.stellar.publicKey,
    tokenAddress,
    amount,
    0
  );
  await submitRelayerTransfer({
    proof: zk.proofHex,
    nullifier_1: zk.nullifier1Hex,
    nullifier_2: zk.nullifier2Hex,
    output_commitment_1: commitment,
    encrypted_note_1: encHex,
    output_commitment_2: ZERO_COMMITMENT,
    encrypted_note_2: "00",
    root: await spendRootFor(input1),
  });

  // Record the new note before retiring the old ones, so funds are never
  // invisible: at worst an old note shows until the next pass marks it.
  await postNote({ commitment, encrypted_note: encHex, recipient_viewing_key: input.to.viewing.publicKey });
  for (const spent of [input1, input2]) {
    if (spent) await spendNote({ commitment: spent.commitment, ...signedTimestamp(input.from) });
  }
  return { commitment, amount };
}
