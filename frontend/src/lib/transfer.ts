// Moves funds between the user's two balances:
//   private -> public: a shielded-pool withdrawal whose recipient is the user's
//                      smart wallet (same path as Send's external withdrawal)
//   public -> private: the smart wallet calls the pool's deposit(), signed with
//                      the wallet passkey; the new note belongs to the user

import { getSpendingKey, getUser, signAuthRequest } from "@/lib/auth";
import { postNote, postTransaction, spendNote } from "@/lib/backend";
import { encryptNote } from "@/lib/crypto";
import { selfNoteSecret } from "@/lib/ownedNotes";
import { withdrawFromPool } from "@/lib/privateWithdraw";
import { withNoteLock } from "@/lib/reshield";
import { depositFromSmartWallet, loadSmartWallet, type WalletToken } from "@/lib/smartWallet";
import { TOKENS } from "@/lib/stellar";
import { calculateCommitment } from "@/lib/zk";

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
    const user = await signedInUser();
    const wallet = await loadSmartWallet();
    if (!wallet.address) throw new Error("Create your public wallet first.");
    return withdrawFromPool({ user, asset, amount, recipient: wallet.address, onStatus, transfer: "to-public" });
  });
}

/** The user's public smart wallet -> their private balance. Returns the transaction hash. */
export async function transferToPrivate(
  asset: WalletToken,
  amount: number,
  onStatus: (m: string) => void = () => undefined,
  options: { useRecoveryKey?: boolean } = {}
) {
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
  onStatus(options.useRecoveryKey ? `Moving ${amount} ${asset} with your recovery key…` : "Confirm with your wallet passkey…");
  let hash: string;
  try {
    hash = await depositFromSmartWallet(asset, amount, commitment, encryptedNote, options);
  } catch (err) {
    // Nothing was deposited; the note must not count towards the balance.
    await spendNote({ commitment, ...signedSpend(me.email) }).catch(() => undefined);
    throw err;
  }
  await recordTransaction(me.id, { from: "public wallet", amount, asset, type: "deposit", hash, transfer: "to-private" });
  return hash;
}

/**
 * Lost wallet passkey: moves everything in the public wallet into the private
 * balance, signed by the recovery key from the (unlocked) vault.
 */
export async function recoverPublicFunds(
  balances: Record<WalletToken, number>,
  onStatus: (m: string) => void = () => undefined
): Promise<string[]> {
  const hashes: string[] = [];
  for (const asset of ["USDC", "XLM"] as WalletToken[]) {
    const amount = Math.floor((balances[asset] ?? 0) * 1e7) / 1e7;
    if (amount > 0) hashes.push(await transferToPrivate(asset, amount, onStatus, { useRecoveryKey: true }));
  }
  if (hashes.length === 0) throw new Error("Your public wallet is empty; there is nothing to recover.");
  return hashes;
}

function signedSpend(email: string) {
  const timestamp = Date.now().toString();
  const signature = signAuthRequest(email, timestamp);
  return signature ? { timestamp, signature } : {};
}
