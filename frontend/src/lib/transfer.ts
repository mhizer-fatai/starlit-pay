// Moves funds between the user's two balances:
//   private -> public: a shielded-pool withdrawal whose recipient is the user's
//                      smart wallet (same path as Send's external withdrawal)
//   public -> private: the smart wallet calls the pool's deposit(), signed with
//                      the wallet passkey; the new note belongs to the user

import { getSpendingKey, getUser, getViewingSecret, signAuthRequest } from "@/lib/auth";
import { fetchNotes, postNote, postTransaction, spendNote, submitRelayerWithdraw } from "@/lib/backend";
import { bytesToHex, encryptNote } from "@/lib/crypto";
import { getSpendableNotes, spendRootFor } from "@/lib/notes";
import { selfNoteSecret } from "@/lib/ownedNotes";
import { withNoteLock } from "@/lib/reshield";
import { depositFromSmartWallet, loadSmartWallet, type WalletToken } from "@/lib/smartWallet";
import { TOKENS } from "@/lib/stellar";
import { calculateCommitment, generateShieldedPaymentProof } from "@/lib/zk";

const ZERO_COMMITMENT = "0".repeat(64);

async function signedInUser() {
  const me = await getUser();
  if (!me?.public_encryption_key) throw new Error("Sign in first.");
  return me;
}

function recordTransaction(userId: string, details: Record<string, unknown>) {
  const payload = JSON.stringify({ ...details, at: new Date().toISOString() });
  return postTransaction({ user_id: userId, encrypted_payload: btoa(payload) }).catch((err) =>
    console.error("Failed to record transfer:", err)
  );
}

/** Private balance -> the user's public smart wallet. Returns the transaction hash. */
export function transferToPublic(asset: WalletToken, amount: number, onStatus: (m: string) => void = () => undefined) {
  return withNoteLock(async () => {
    const me = await signedInUser();
    const wallet = await loadSmartWallet();
    if (!wallet.address) throw new Error("Create your public wallet first.");
    const viewingSecret = getViewingSecret(me.email);
    const spendingKey = getSpendingKey(me.email);
    if (!viewingSecret || !spendingKey) throw new Error("Your wallet is locked. Unlock it first.");
    const tokenAddress = TOKENS[asset];
    const viewingKey = me.public_encryption_key!;

    onStatus("Finding your private funds…");
    const { notes } = await fetchNotes(viewingKey);
    const spendable = getSpendableNotes(notes, viewingSecret, asset);
    const inputs: typeof spendable = [];
    let inputSum = 0;
    for (const note of spendable) {
      inputs.push(note);
      inputSum += note.amount;
      if (inputs.length === 2 || inputSum >= amount - 0.0001) break;
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
    let secret2 = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    let commitment2 = await calculateCommitment(0, viewingKey, tokenAddress, secret2);
    if (input2) {
      secret2 = input2.secret;
      commitment2 = input2.commitment;
    }

    // Change returns to the user as a note only their spending key can spend.
    let changeCommitment = ZERO_COMMITMENT;
    let changeEncrypted = "00";
    if (changeAmount > 0.0001) {
      const { secret, n } = await selfNoteSecret(spendingKey);
      changeCommitment = await calculateCommitment(changeAmount, viewingKey, tokenAddress, secret);
      const enc = encryptNote(changeAmount, asset, secret, me.username, viewingKey, { n });
      changeEncrypted = enc.ephemeralPublicKey + enc.nonce + enc.ciphertext;
    }

    onStatus("Preparing the private withdrawal…");
    const proof = await generateShieldedPaymentProof(
      input1!.secret,
      input1!.commitment,
      secret2,
      commitment2,
      wallet.address,
      tokenAddress,
      amount,
      changeAmount,
      onStatus
    );

    onStatus("Moving funds to your public wallet…");
    const result = await submitRelayerWithdraw({
      proof: proof.proofHex,
      nullifier_1: proof.nullifier1Hex,
      nullifier_2: proof.nullifier2Hex,
      recipient: wallet.address,
      token: tokenAddress,
      amount,
      root: spendRoot,
      change_commitment: changeCommitment,
      encrypted_change_note: changeEncrypted,
    });

    if (changeAmount > 0.0001) {
      await postNote({ commitment: changeCommitment, encrypted_note: changeEncrypted, recipient_viewing_key: viewingKey }).catch(
        (err) => console.error("Failed to register change note:", err)
      );
    }
    const timestamp = Date.now().toString();
    const signature = signAuthRequest(me.email, timestamp) || undefined;
    for (const note of inputs) {
      await spendNote({ commitment: note.commitment, ...(signature ? { timestamp, signature } : {}) }).catch((err) =>
        console.error("Failed to mark note as spent:", err)
      );
    }
    await recordTransaction(me.id, { to: wallet.address, amount, asset, type: "withdraw", hash: result.hash, transfer: "to-public" });
    return result.hash;
  });
}

/** The user's public smart wallet -> their private balance. Returns the transaction hash. */
export async function transferToPrivate(asset: WalletToken, amount: number, onStatus: (m: string) => void = () => undefined) {
  const me = await signedInUser();
  const spendingKey = getSpendingKey(me.email);
  if (!spendingKey) throw new Error("Your wallet is locked. Unlock it first.");
  const viewingKey = me.public_encryption_key!;
  const tokenAddress = TOKENS[asset];

  const { secret, n } = await selfNoteSecret(spendingKey);
  const commitment = await calculateCommitment(amount, viewingKey, tokenAddress, secret);
  const enc = encryptNote(amount, asset, secret, me.username, viewingKey, { n });
  const encryptedNote = enc.ephemeralPublicKey + enc.nonce + enc.ciphertext;

  // Register the note first (as the gateway does) so the indexer can attach its root.
  await postNote({ commitment, encrypted_note: encryptedNote, recipient_viewing_key: viewingKey });
  onStatus("Confirm with your wallet passkey…");
  let hash: string;
  try {
    hash = await depositFromSmartWallet(asset, amount, commitment, encryptedNote);
  } catch (err) {
    // Nothing was deposited; the note must not count towards the balance.
    await spendNote({ commitment, ...signedSpend(me.email) }).catch(() => undefined);
    throw err;
  }
  await recordTransaction(me.id, { from: "public wallet", amount, asset, type: "deposit", hash, transfer: "to-private" });
  return hash;
}

function signedSpend(email: string) {
  const timestamp = Date.now().toString();
  const signature = signAuthRequest(email, timestamp);
  return signature ? { timestamp, signature } : {};
}
