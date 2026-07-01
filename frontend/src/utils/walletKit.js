import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";

// Initialize the static StellarWalletsKit targeting TESTNET
StellarWalletsKit.init({
  network: Networks.TESTNET,
  modules: defaultModules(),
});

/**
 * Connects the wallet using Stellar Wallets Kit.
 * Calls StellarWalletsKit.authModal and triggers callbacks on selection/error.
 * @param {object} params
 * @param {function} params.onConnect - Callback invoked with (address, walletId, walletName)
 * @param {function} params.onError - Callback invoked with (error)
 */
export const connectWithWalletKit = async ({ onConnect, onError }) => {
  try {
    const { address } = await StellarWalletsKit.authModal();
    if (!address) {
      throw new Error("Could not retrieve address from wallet");
    }

    const selectedWalletId = StellarWalletsKit.selectedModule?.productId || "Connected Wallet";
    const selectedWalletName = StellarWalletsKit.selectedModule?.productName || "Connected Wallet";

    if (onConnect) {
      onConnect(address, selectedWalletId, selectedWalletName);
    }
  } catch (err) {
    if (onError) {
      onError(err);
    } else {
      console.error(err);
    }
  }
};

/**
 * Signs a transaction XDR with the currently selected wallet.
 * @param {string} xdr
 * @param {string} address
 * @returns {Promise<string>} The signed transaction XDR
 */
export const signWithWalletKit = async (xdr, address) => {
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
    networkPassphrase: Networks.TESTNET,
    address: address
  });
  return signedTxXdr;
};
