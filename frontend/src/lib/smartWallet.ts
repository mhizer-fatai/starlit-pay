// Public smart wallet: an OpenZeppelin smart account (via smart-account-kit)
// controlled by the user's passkey, which Stellar verifies on-chain
// (secp256r1, CAP-0051). It holds public XLM/USDC for spending; money arrives
// by withdrawing from the private balance. Fees are paid by the Starlit
// relayer, which only sponsors this user's own wallet actions.
//
// Signers: rule 0 = the passkey (everyday use); rule 1 = a backup Ed25519 key,
// the vault's Stellar key, so the recovery code also recovers the wallet. They
// are separate rules because one rule with two signers would require both.

import * as StellarSdk from "@stellar/stellar-sdk";
import {
  IndexedDBStorage,
  SmartAccountKit,
  createDefaultContext,
  createEd25519Signer,
} from "smart-account-kit";

import { getUnlockedKeys, getVaultSecrets } from "@/lib/auth";
import { BACKEND_URL, getSmartWallet, getSmartWalletRelayToken, type SmartWalletInfo } from "@/lib/backend";
import { RPC_URL, rpc } from "@/lib/stellar";
import { fromB64u } from "@/lib/vault/crypto";
import { authApi, passkeyFlows } from "@/lib/vault/client";

export type { SmartWalletInfo };
export type WalletToken = "XLM" | "USDC";

/** The passkey picked cannot control an on-chain wallet (not ES256, e.g. Windows Hello RSA). */
export class NeedsWalletPasskeyError extends Error {
  constructor() {
    super(
      "This passkey can't control an on-chain wallet (Stellar needs an ES256 passkey). Create a wallet passkey with your phone or a security key."
    );
    this.name = "NeedsWalletPasskeyError";
  }
}

async function createKit(info: SmartWalletInfo): Promise<SmartAccountKit> {
  const { token } = await getSmartWalletRelayToken();
  return new SmartAccountKit({
    rpcUrl: RPC_URL,
    networkPassphrase: info.config.networkPassphrase,
    accountWasmHash: info.config.accountWasmHash,
    webauthnVerifierAddress: info.config.webauthnVerifier,
    ed25519VerifierAddress: info.config.ed25519Verifier,
    rpId: window.location.hostname,
    rpName: "Starlit Pay",
    relayerUrl: `${BACKEND_URL}/api/smart-wallet/relay/${encodeURIComponent(token)}`,
    indexerUrl: false,
    storage: new IndexedDBStorage(),
  });
}

export function tokenContract(info: SmartWalletInfo, token: WalletToken): string {
  return token === "XLM" ? info.config.xlmSac : info.config.usdcSac;
}

export function loadSmartWallet(): Promise<SmartWalletInfo> {
  return getSmartWallet();
}

function failure(result: { success: boolean; error?: { message?: string } | string }, fallback: string): Error {
  const message = typeof result.error === "string" ? result.error : result.error?.message;
  return new Error(message || fallback);
}

/**
 * Creates the user's smart wallet. Uses an existing ES256 passkey: the one the
 * user picks in the prompt, or `credentialId` when one was just created.
 */
export async function createSmartWallet(options: { credentialId?: string; onStatus?: (m: string) => void } = {}): Promise<string> {
  const status = options.onStatus ?? (() => undefined);
  const info = await loadSmartWallet();
  if (info.address) return info.address;
  const vaultKeys = getUnlockedKeys();
  if (!vaultKeys) throw new Error("Unlock your wallet first.");

  const kit = await createKit(info);
  let credentialId = options.credentialId;
  if (!credentialId) {
    status("Choose the passkey that will control your wallet…");
    credentialId = (await kit.authenticatePasskey()).credentialId;
  }
  const passkey = info.passkeys.find((p) => p.credentialId === credentialId);
  if (!passkey) throw new NeedsWalletPasskeyError();

  status("Creating your wallet on Stellar…");
  await kit.credentials.save({ credentialId, publicKey: fromB64u(passkey.publicKey), nickname: "Starlit Pay" });
  const deployed = await kit.credentials.deploy(credentialId, { autoSubmit: true });
  if (!deployed.submitResult?.success) throw failure(deployed.submitResult ?? { success: false }, "The wallet could not be created.");

  status("Adding your recovery key (confirm with your passkey)…");
  const backupKey = StellarSdk.Keypair.fromPublicKey(vaultKeys.stellar.publicKey).rawPublicKey();
  const addRule = await kit.rules.add(
    createDefaultContext(),
    "Recovery",
    [createEd25519Signer(info.config.ed25519Verifier, backupKey)],
    new Map()
  );
  const added = await kit.signAndSubmitAdmin(addRule);
  if (!added.success) throw failure(added, "The wallet was created, but the recovery key could not be added.");
  return deployed.contractId;
}

/**
 * Adds an ES256 passkey that can control the wallet (e.g. Windows Hello keys
 * are RSA, so the user scans the QR code with a phone). Returns its credential id.
 */
export async function addWalletPasskey(deviceName?: string): Promise<string> {
  const secrets = getVaultSecrets();
  if (!secrets) throw new Error("Your wallet is locked. Sign in again first.");
  const before = new Set((await loadSmartWallet()).passkeys.map((p) => p.credentialId));
  const session = await authApi.getSession();
  if (!session.fresh) await passkeyFlows.stepUp();
  await passkeyFlows.addPasskey(secrets, deviceName ?? "Wallet passkey", { es256Only: true });
  const added = (await loadSmartWallet()).passkeys.find((p) => !before.has(p.credentialId));
  if (!added) throw new NeedsWalletPasskeyError();
  return added.credentialId;
}

/** Balance of XLM or USDC held by a contract address (read-only simulation). */
export async function smartWalletBalance(info: SmartWalletInfo, token: WalletToken): Promise<number> {
  if (!info.address) return 0;
  const source = new StellarSdk.Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0");
  const tx = new StellarSdk.TransactionBuilder(source, { fee: StellarSdk.BASE_FEE, networkPassphrase: info.config.networkPassphrase })
    .addOperation(new StellarSdk.Contract(tokenContract(info, token)).call("balance", new StellarSdk.Address(info.address).toScVal()))
    .setTimeout(30)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(sim) || !sim.result) return 0;
  return Number(StellarSdk.scValToNative(sim.result.retval)) / 1e7;
}

/** Sends XLM/USDC from the smart wallet. The passkey signs; Stellar verifies it on-chain. */
export async function sendFromSmartWallet(token: WalletToken, recipient: string, amount: number): Promise<string> {
  const info = await loadSmartWallet();
  if (!info.address) throw new Error("Create your smart wallet first.");
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(recipient) && !StellarSdk.StrKey.isValidContract(recipient)) {
    throw new Error("Enter a valid Stellar address (G… or C…).");
  }
  if (!(amount > 0)) throw new Error("Enter an amount greater than 0.");

  const kit = await createKit(info);
  // Silent restore from this browser's stored session, else prompt the passkey.
  const restored = await kit.connectWallet();
  if (!restored || kit.contractId !== info.address) await kit.connectWallet({ contractId: info.address, prompt: true });

  const result = await kit.transfer(tokenContract(info, token), recipient, amount);
  if (!result.success) throw failure(result, "The payment could not be sent.");
  return result.hash ?? "";
}
