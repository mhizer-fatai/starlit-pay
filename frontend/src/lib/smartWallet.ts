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
import {
  BACKEND_URL,
  getSmartWallet,
  getSmartWalletRelayToken,
  postSmartWalletBirth,
  type SmartWalletInfo,
  type WalletBirth,
} from "@/lib/backend";
import { RPC_URL, rpc } from "@/lib/stellar";
import { fromB64u, toB64u } from "@/lib/vault/crypto";
import { authApi, getEmailProof, passkeyFlows } from "@/lib/vault/client";

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

// One store per page: the kit keeps each wallet's verified creation record here.
const kitStorage = new IndexedDBStorage();

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
    // Origin the kit accepts for the one-time "you own this passkey" check per browser.
    allowedOrigins: [window.location.origin],
    relayerUrl: `${BACKEND_URL}/api/smart-wallet/relay/${encodeURIComponent(token)}`,
    // No indexer: the wallet's creation record comes from Starlit (see ensureWalletRecord)
    // and the kit re-checks it on-chain / in Horizon history before connecting.
    indexerUrl: false,
    storage: kitStorage,
  });
}

export function tokenContract(info: SmartWalletInfo, token: WalletToken): string {
  return token === "XLM" ? info.config.xlmSac : info.config.usdcSac;
}

export function loadSmartWallet(): Promise<SmartWalletInfo> {
  return getSmartWallet();
}

/**
 * The wallet address a passkey's wallet gets (the shared deployer uses
 * salt = sha256(credential id)), so the app knows which passkey controls the
 * wallet and can ask for exactly that one instead of showing a passkey picker.
 */
export function walletAddressFor(info: SmartWalletInfo, credentialId: string): string {
  const preimage = StellarSdk.xdr.HashIdPreimage.envelopeTypeContractId(
    new StellarSdk.xdr.HashIdPreimageContractId({
      networkId: StellarSdk.hash(Buffer.from(info.config.networkPassphrase)),
      contractIdPreimage: StellarSdk.xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new StellarSdk.xdr.ContractIdPreimageFromAddress({
          address: StellarSdk.Address.fromString(info.config.deployer).toScAddress(),
          salt: StellarSdk.hash(Buffer.from(fromB64u(credentialId))),
        })
      ),
    })
  );
  return StellarSdk.StrKey.encodeContract(StellarSdk.hash(preimage.toXDR()));
}

/** The registered passkey that controls the user's wallet, if it is still registered. */
export function walletPasskey(info: SmartWalletInfo) {
  return info.address ? info.passkeys.find((p) => walletAddressFor(info, p.credentialId) === info.address) ?? null : null;
}

export interface WalletSigners {
  /** Credential ids of the passkeys the wallet accepts (read from its on-chain rules). */
  passkeyCredentialIds: string[];
  /** The same passkeys with their 65-byte P-256 public keys. */
  passkeys: { credentialId: string; publicKey: Uint8Array }[];
  /** Whether the vault's backup key (recovery) is a signer. */
  hasRecoveryKey: boolean;
}

const MAX_RULES = 10;

/** Reads the wallet's signers from its context rules on Stellar (read-only simulation). */
export async function readWalletSigners(info: SmartWalletInfo): Promise<WalletSigners> {
  const result: WalletSigners = { passkeyCredentialIds: [], passkeys: [], hasRecoveryKey: false };
  if (!info.address) return result;
  const source = new StellarSdk.Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0");
  for (let id = 0; id < MAX_RULES; id++) {
    const tx = new StellarSdk.TransactionBuilder(source, { fee: StellarSdk.BASE_FEE, networkPassphrase: info.config.networkPassphrase })
      .addOperation(new StellarSdk.Contract(info.address).call("get_context_rule", StellarSdk.nativeToScVal(id, { type: "u32" })))
      .setTimeout(30)
      .build();
    const sim = await rpc.simulateTransaction(tx);
    if (StellarSdk.rpc.Api.isSimulationError(sim) || !sim.result) {
      if (id === 0) throw new Error("Could not read your public wallet from Stellar. Try again.");
      continue; // removed or not created; ids are not reused
    }
    const rule = StellarSdk.scValToNative(sim.result.retval) as { signers?: unknown[] };
    for (const signer of rule.signers ?? []) {
      if (!Array.isArray(signer) || signer[0] !== "External") continue;
      const [, verifier, keyData] = signer as [string, string, Uint8Array];
      if (verifier === info.config.webauthnVerifier && keyData.length > 65) {
        const credentialId = toB64u(keyData.subarray(65));
        result.passkeyCredentialIds.push(credentialId);
        result.passkeys.push({ credentialId, publicKey: new Uint8Array(keyData.subarray(0, 65)) });
      } else if (verifier === info.config.ed25519Verifier) {
        result.hasRecoveryKey = true;
      }
    }
  }
  return result;
}

/**
 * The passkey to ask for when the wallet signs. Read from the wallet itself, so
 * it still works if that passkey was removed from the Starlit account (the key
 * still lives in the user's phone or password manager).
 */
async function signingCredential(info: SmartWalletInfo): Promise<string> {
  const registered = walletPasskey(info);
  if (registered) return registered.credentialId;
  const { passkeyCredentialIds } = await readWalletSigners(info);
  if (passkeyCredentialIds.length === 0) throw new Error("This wallet has no passkey signer.");
  return passkeyCredentialIds[0]!;
}

const INDEXER = "https://testnet.mercurydata.app/rest/smart-account-indexer";

/**
 * Finds the transaction that created a wallet made before Starlit stored it:
 * the ledger where an indexer first saw the wallet, then the wallet's own
 * setup events in that ledger. The server checks the result on-chain.
 */
async function discoverBirth(info: SmartWalletInfo, credentialId: string): Promise<WalletBirth> {
  const hexId = Array.from(fromB64u(credentialId), (b) => b.toString(16).padStart(2, "0")).join("");
  const res = await fetch(`${INDEXER}/api/lookup/${hexId}`);
  const lookup = res.ok ? ((await res.json()) as { contracts?: { contract_id: string; first_seen_ledger?: number }[] }) : null;
  const firstSeen = lookup?.contracts?.find((c) => c.contract_id === info.address)?.first_seen_ledger;
  if (!firstSeen) throw new Error("Could not find when your public wallet was created. Try again later.");
  const { events } = await rpc.getEvents({
    startLedger: firstSeen,
    filters: [{ type: "contract", contractIds: [info.address!] }],
    limit: 5,
  });
  const first = events[0];
  if (!first) throw new Error("Could not find when your public wallet was created. Try again later.");
  return (await postSmartWalletBirth(first.txHash)).birth;
}

/**
 * The kit only connects to a wallet whose creation it can verify. Give it the
 * creation record (stored by Starlit) for this browser, so it works on any
 * device, not just the one that created the wallet.
 */
async function ensureWalletRecord(info: SmartWalletInfo, credentialId: string) {
  const stored = await kitStorage.get(credentialId);
  if (stored?.contractId === info.address && stored.creationTransactionHash && stored.creationLedger) return;
  const birth = info.birth ?? (await discoverBirth(info, credentialId));
  const onChain = (await readWalletSigners(info)).passkeys.find((p) => p.credentialId === credentialId);
  if (!onChain) throw new Error("This passkey does not control your public wallet.");
  const record = {
    contractId: info.address!,
    birthWasmHash: info.config.accountWasmHash,
    creationTransactionHash: birth.txHash,
    creationLedger: birth.ledger,
    deploymentStatus: "deployed" as const,
    isPrimary: true,
  };
  if (stored) await kitStorage.update(credentialId, record);
  else await kitStorage.save({ credentialId, publicKey: onChain.publicKey, nickname: "Starlit Pay", createdAt: Date.now(), ...record });
}

async function connectedKit(info: SmartWalletInfo): Promise<{ kit: SmartAccountKit; credentialId: string }> {
  const kit = await createKit(info);
  const credentialId = await signingCredential(info);
  await ensureWalletRecord(info, credentialId);
  await kit.connectWallet({ contractId: info.address!, credentialId });
  return { kit, credentialId };
}

async function submitRecoveryRule(kit: SmartAccountKit, info: SmartWalletInfo, stellarPublicKey: string) {
  const backupKey = StellarSdk.Keypair.fromPublicKey(stellarPublicKey).rawPublicKey();
  const addRule = await kit.rules.add(
    createDefaultContext(),
    "Recovery",
    [createEd25519Signer(info.config.ed25519Verifier, backupKey)],
    new Map()
  );
  const added = await kit.signAndSubmitAdmin(addRule);
  if (!added.success) throw failure(added, "The wallet could not be protected with your recovery code.");
}

/**
 * Adds the vault's backup key to an existing wallet (its own rule), so the
 * recovery code can recover the wallet. Signed with the wallet passkey.
 */
export async function addRecoveryKey(): Promise<void> {
  const info = await loadSmartWallet();
  if (!info.address) throw new Error("Create your public wallet first.");
  const vaultKeys = getUnlockedKeys();
  if (!vaultKeys) throw new Error("Unlock your wallet first.");
  if ((await readWalletSigners(info)).hasRecoveryKey) return;
  const { kit } = await connectedKit(info);
  await submitRecoveryRule(kit, info, vaultKeys.stellar.publicKey);
}

function failure(result: { success: boolean; error?: { message?: string } | string }, fallback: string): Error {
  const message = typeof result.error === "string" ? result.error : result.error?.message;
  return new Error(message || fallback);
}

/**
 * Creates the user's smart wallet, controlled by one of their registered ES256
 * passkeys (picked in the app, so no browser passkey picker is shown).
 */
export async function createSmartWallet(options: { credentialId: string; onStatus?: (m: string) => void }): Promise<string> {
  const status = options.onStatus ?? (() => undefined);
  const info = await loadSmartWallet();
  if (info.address) return info.address;
  const vaultKeys = getUnlockedKeys();
  if (!vaultKeys) throw new Error("Unlock your wallet first.");

  const kit = await createKit(info);
  const { credentialId } = options;
  const passkey = info.passkeys.find((p) => p.credentialId === credentialId);
  if (!passkey) throw new NeedsWalletPasskeyError();

  status("Creating your wallet on Stellar…");
  await kit.credentials.save({ credentialId, publicKey: fromB64u(passkey.publicKey), nickname: "Starlit Pay" });
  const deployed = await kit.credentials.deploy(credentialId, { autoSubmit: true });
  if (!deployed.submitResult?.success) throw failure(deployed.submitResult ?? { success: false }, "The wallet could not be created.");

  status("Protecting the wallet with your recovery code (confirm with your passkey)…");
  try {
    await submitRecoveryRule(kit, info, vaultKeys.stellar.publicKey);
  } catch (err) {
    // The wallet exists; the card offers "Protect with recovery code" to finish this step.
    throw new Error(`Your wallet was created, but it isn't protected with your recovery code yet: ${err instanceof Error ? err.message : err}`);
  }
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
  const [session, { passkeys }] = await Promise.all([authApi.getSession(), authApi.listPasskeys()]);
  // With no passkey yet there is nothing to confirm with; the Google proof is used instead.
  if (!session.fresh && passkeys.length > 0) await passkeyFlows.stepUp();
  await passkeyFlows.addPasskey(secrets, deviceName ?? "Wallet passkey", { es256Only: true, emailProof: await getEmailProof() });
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

  const { kit } = await connectedKit(info);
  const result = await kit.transfer(tokenContract(info, token), recipient, amount);
  if (!result.success) throw failure(result, "The payment could not be sent.");
  return result.hash ?? "";
}

/**
 * Deposits from the smart wallet into the shielded pool (public -> private).
 * The wallet authorises pool.deposit (and the token transfer inside it) with
 * its passkey; the commitment/note were created for the user beforehand.
 */
export async function depositFromSmartWallet(
  token: WalletToken,
  amount: number,
  commitmentHex: string,
  encryptedNoteHex: string
): Promise<string> {
  const info = await loadSmartWallet();
  if (!info.address) throw new Error("Create your public wallet first.");
  if (!(amount > 0)) throw new Error("Enter an amount greater than 0.");
  const { kit, credentialId } = await connectedKit(info);

  const func = StellarSdk.xdr.HostFunction.hostFunctionTypeInvokeContract(
    new StellarSdk.xdr.InvokeContractArgs({
      contractAddress: StellarSdk.Address.fromString(info.config.poolContract).toScAddress(),
      functionName: "deposit",
      args: [
        StellarSdk.Address.fromString(info.address).toScVal(),
        StellarSdk.Address.fromString(tokenContract(info, token)).toScVal(),
        StellarSdk.nativeToScVal(BigInt(Math.round(amount * 1e7)), { type: "i128" }),
        StellarSdk.nativeToScVal(Buffer.from(commitmentHex, "hex"), { type: "bytes" }),
        StellarSdk.nativeToScVal(Buffer.from(encryptedNoteHex, "hex"), { type: "bytes" }),
      ],
    })
  );
  const tx = await StellarSdk.contract.AssembledTransaction.buildWithOp(
    StellarSdk.Operation.invokeHostFunction({ func, auth: [] }),
    {
      contractId: info.config.poolContract,
      networkPassphrase: info.config.networkPassphrase,
      rpcUrl: RPC_URL,
      method: "deposit",
      parseResultXdr: (value: StellarSdk.xdr.ScVal) => value,
    }
  );
  if (tx.simulation && StellarSdk.rpc.Api.isSimulationError(tx.simulation)) {
    throw new Error("The deposit could not be prepared. Check your public wallet balance.");
  }
  const result = await kit.signAndSubmit(tx, { credentialId });
  if (!result.success) throw failure(result, "The transfer could not be completed.");
  return result.hash ?? "";
}
