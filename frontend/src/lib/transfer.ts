// Moves funds between the user's two balances:
//   private -> public: a private-pool withdrawal to the user's own smart wallet
//   public -> private: the smart wallet sends to Starlit's gateway; the relay
//                      that submits it credits the user, and this device
//                      deposits the credit into the private pools

import { getUser } from "@/lib/auth";
import { fetchGatewayAddress, postTransaction } from "@/lib/backend";
import { completeArrivals, MIN_DEPOSIT, sendZkPayment } from "@/lib/privateWallet";
import { loadSmartWallet, sendToGatewayFromSmartWallet, type WalletToken } from "@/lib/smartWallet";

const asText = (amount: number) => amount.toFixed(7).replace(/\.?0+$/, "");

/** Private balance -> the user's public smart wallet. Returns the transaction hash. */
export async function transferToPublic(asset: WalletToken, amount: number, onStatus: (m: string) => void = () => undefined) {
  const me = await getUser();
  if (!me) throw new Error("Sign in first.");
  const wallet = await loadSmartWallet();
  if (!wallet.address) throw new Error("Create your public wallet first.");
  const { hashes, leaves } = await sendZkPayment({ asset, amount: asText(amount), to: { kind: "address", address: wallet.address } }, onStatus);
  const hash = hashes.at(-1) ?? "";
  const record = { to: wallet.address, amount, asset, type: "withdraw", hash, transfer: "to-public", leaves, at: new Date().toISOString() };
  await postTransaction({ user_id: me.id, encrypted_payload: btoa(JSON.stringify(record)) }).catch((err) =>
    console.error("Failed to record transfer:", err)
  );
  return hash;
}

/**
 * The user's public smart wallet -> their private balance. Returns the
 * wallet's transaction hash. The deposit is shown in history as its "Deposit".
 */
export async function transferToPrivate(
  asset: WalletToken,
  amount: number,
  onStatus: (m: string) => void = () => undefined,
  options: { useRecoveryKey?: boolean } = {}
) {
  if (amount < MIN_DEPOSIT) throw new Error(`The smallest amount to move into your private balance is ${MIN_DEPOSIT} ${asset}.`);
  const { address: gateway } = await fetchGatewayAddress();
  onStatus(options.useRecoveryKey ? `Moving ${amount} ${asset} with your recovery key…` : "Confirm with your wallet passkey…");
  const hash = await sendToGatewayFromSmartWallet(asset, amount, gateway, options);
  onStatus("Adding it to your private balance…");
  // If this doesn't finish here, it's still credited and completes on the next Dashboard visit.
  await completeArrivals(onStatus).catch((err) => console.warn("Deposit will complete later:", err));
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
    if (amount >= MIN_DEPOSIT) hashes.push(await transferToPrivate(asset, amount, onStatus, { useRecoveryKey: true }));
  }
  if (hashes.length === 0) throw new Error(`Your public wallet has less than ${MIN_DEPOSIT} to recover.`);
  return hashes;
}
