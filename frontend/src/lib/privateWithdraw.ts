// Withdraws from the private balance to any Stellar address (G… or C…). Used by
// Send's withdrawal and by Transfer (private -> public). Callers hold the note
// lock, so re-shielding never spends the same note at the same time.

import { getSpendingKey, getViewingSecret, signAuthRequest, type SessionUser } from "@/lib/auth";
import { fetchNotes, postNote, postTransaction, spendNote, submitRelayerWithdraw } from "@/lib/backend";
import { bytesToHex, encryptNote } from "@/lib/crypto";
import { getSpendableNotes, spendRootFor } from "@/lib/notes";
import { withoutSpentOnChain } from "@/lib/spentNotes";
import { selfNoteSecret } from "@/lib/ownedNotes";
import { TOKENS } from "@/lib/stellar";
import type { Transfer } from "@/lib/wallet";
import { calculateCommitment, generateShieldedPaymentProof } from "@/lib/zk";

const ZERO_COMMITMENT = "0".repeat(64);
const DUST = 0.0001;

export async function withdrawFromPool(input: {
  user: SessionUser;
  asset: "XLM" | "USDC";
  amount: number;
  recipient: string;
  onStatus?: (message: string) => void;
  /** Set when the recipient is the user's own public wallet. */
  transfer?: Transfer;
  /** Leave it out of history (moving to the new pool: the deposit gets the record). */
  unrecorded?: boolean;
  /** Notes not to use: just spent, but the database may not say so yet. */
  exclude?: ReadonlySet<string>;
}): Promise<string> {
  const { user, asset, amount, recipient, transfer } = input;
  const onStatus = input.onStatus ?? (() => undefined);
  const viewingKey = user.public_encryption_key;
  const viewingSecret = getViewingSecret(user.email);
  const spendingKey = getSpendingKey(user.email);
  if (!viewingKey || !viewingSecret || !spendingKey) throw new Error("Your wallet is locked. Unlock it first.");
  const tokenAddress = TOKENS[asset];
  if (!tokenAddress) throw new Error(`Unsupported asset: ${asset}`);

  onStatus("Finding your private funds…");
  const { notes } = await fetchNotes(viewingKey);
  const spendable = (await withoutSpentOnChain(getSpendableNotes(notes, viewingSecret, asset))).filter(
    (note) => !input.exclude?.has(note.commitment)
  );
  const inputs: typeof spendable = [];
  let inputSum = 0;
  for (const note of spendable) {
    inputs.push(note);
    inputSum += note.amount;
    if (inputs.length === 2 || inputSum >= amount - DUST) break;
  }
  if (inputSum < amount) {
    const available = spendable.reduce((sum, n) => sum + n.amount, 0);
    throw new Error(
      available >= amount
        ? "Your private funds are split across many notes. Move a smaller amount first."
        : `Not enough private ${asset}. Available: ${available.toFixed(2)} ${asset}.`
    );
  }

  const [input1, input2] = inputs;
  const changeAmount = inputSum - amount;
  const spendRoot = await spendRootFor(input1!);

  // With one input note, the second proof input is a dummy zero-value note.
  let secret2 = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  let commitment2 = await calculateCommitment(0, viewingKey, tokenAddress, secret2);
  if (input2) {
    secret2 = input2.secret;
    commitment2 = input2.commitment;
  }

  // Change returns to the user as a note only their spending key can spend.
  let changeCommitment = ZERO_COMMITMENT;
  let changeEncrypted = "00";
  if (changeAmount > DUST) {
    const { secret, n } = await selfNoteSecret(spendingKey);
    changeCommitment = await calculateCommitment(changeAmount, viewingKey, tokenAddress, secret);
    const enc = encryptNote(changeAmount, asset, secret, user.username, viewingKey, { n });
    changeEncrypted = enc.ephemeralPublicKey + enc.nonce + enc.ciphertext;
  }

  onStatus("Preparing the private withdrawal…");
  const proof = await generateShieldedPaymentProof(
    input1!.secret,
    input1!.commitment,
    secret2,
    commitment2,
    recipient,
    tokenAddress,
    amount,
    changeAmount,
    onStatus
  );

  onStatus("Submitting the withdrawal…");
  const result = await submitRelayerWithdraw({
    proof: proof.proofHex,
    nullifier_1: proof.nullifier1Hex,
    nullifier_2: proof.nullifier2Hex,
    recipient,
    token: tokenAddress,
    amount,
    root: spendRoot,
    change_commitment: changeCommitment,
    encrypted_change_note: changeEncrypted,
  });

  // The money has moved: bookkeeping failures below must not look like a failed payment.
  if (changeAmount > DUST) {
    await postNote({ commitment: changeCommitment, encrypted_note: changeEncrypted, recipient_viewing_key: viewingKey }).catch(
      (err) => console.error("Failed to register change note:", err)
    );
  }
  const timestamp = Date.now().toString();
  const signature = signAuthRequest(user.email, timestamp) || undefined;
  for (const note of inputs) {
    await spendNote({ commitment: note.commitment, ...(signature ? { timestamp, signature } : {}) }).catch((err) =>
      console.error("Failed to mark note as spent:", err)
    );
  }
  if (input.unrecorded) return result.hash;
  const record = JSON.stringify({
    to: recipient,
    amount,
    asset,
    type: "withdraw",
    hash: result.hash,
    ...(transfer ? { transfer } : {}),
    at: new Date().toISOString(),
  });
  await postTransaction({ user_id: user.id, encrypted_payload: btoa(record) }).catch((err) =>
    console.error("Failed to record withdrawal:", err)
  );
  return result.hash;
}
