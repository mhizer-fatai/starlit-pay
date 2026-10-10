import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";

let isInitialized = false;

function ensureInitialized() {
  if (!isInitialized) {
    try {
      StellarWalletsKit.init({
        network: Networks.TESTNET,
        modules: defaultModules(),
      });
      isInitialized = true;
    } catch {
      // already initialized or SSR context
    }
  }
}

export interface WalletConnectResult {
  address: string;
  walletId: string;
  walletName: string;
}

export async function connectWithWalletKit(): Promise<WalletConnectResult> {
  ensureInitialized();
  const { address } = await StellarWalletsKit.authModal();
  if (!address) {
    throw new Error("Could not retrieve address from wallet");
  }

  const selectedWalletId = (StellarWalletsKit as any).selectedModule?.productId || "Connected Wallet";
  const selectedWalletName = (StellarWalletsKit as any).selectedModule?.productName || "Connected Wallet";

  return {
    address,
    walletId: selectedWalletId,
    walletName: selectedWalletName,
  };
}

export async function signWithWalletKit(xdr: string, address: string): Promise<string> {
  ensureInitialized();
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
    networkPassphrase: Networks.TESTNET,
    address,
  });
  return signedTxXdr;
}
