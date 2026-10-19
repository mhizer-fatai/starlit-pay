import { describe, expect, test } from "vitest";
import * as StellarSdk from "@stellar/stellar-sdk";
// The kit's own derivation (not exported from its entry point).
import { deriveContractAddress } from "../../node_modules/smart-account-kit/dist/utils.js";
import { walletAddressFor, walletPasskey, type SmartWalletInfo } from "@/lib/smartWallet";

const info = (address: string | null, ids: string[]): SmartWalletInfo => ({
  address,
  passkeys: ids.map((credentialId) => ({ credentialId, publicKey: "", deviceName: null })),
  config: {
    accountWasmHash: "",
    webauthnVerifier: "",
    ed25519Verifier: "",
    deployer: "GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N",
    usdcSac: "",
    xlmSac: "",
    networkPassphrase: StellarSdk.Networks.TESTNET,
  },
});

describe("smart wallet address", () => {
  const id = Buffer.from("example-credential-id-bytes").toString("base64url");

  test("matches the address smart-account-kit deploys to", () => {
    const expected = deriveContractAddress(Buffer.from(id, "base64url"), info(null, []).config.deployer, StellarSdk.Networks.TESTNET);
    expect(walletAddressFor(info(null, [id]), id)).toBe(expected);
  });

  test("finds the passkey that controls the wallet", () => {
    const other = Buffer.from("another-credential").toString("base64url");
    const address = walletAddressFor(info(null, [id]), id);
    expect(walletPasskey(info(address, [other, id]))?.credentialId).toBe(id);
    expect(walletPasskey(info(address, [other]))).toBeNull();
  });
});
