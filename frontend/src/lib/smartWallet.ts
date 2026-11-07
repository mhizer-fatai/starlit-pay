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
  Ed25519Signer,
  IndexedDBStorage,
  SmartAccountKit,
  computeEntryAuthDigest,
  createDefaultContext,
  signerToScVal,
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
import { RPC_URL, horizon, rpc } from "@/lib/stellar";
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

export interface WalletPasskey {
  credentialId: string;
  publicKey: Uint8Array;
  ruleId: number;
}

export interface WalletSigners {
  /** Credential ids of the passkeys the wallet accepts (read from its on-chain rules). */
  passkeyCredentialIds: string[];
  /** The same passkeys with their context rule and 65-byte P-256 public keys. */
  passkeys: WalletPasskey[];
  /** Whether the vault's backup key (recovery) is a signer. */
  hasRecoveryKey: boolean;
  /** Context rules whose signer is an Ed25519 backup key: rule id and 32-byte key (hex). */
  recoveryRules: { ruleId: number; publicKeyHex: string }[];
}

const MAX_RULES = 10;

/** Reads the wallet's signers from its context rules on Stellar (read-only simulation). */
export async function readWalletSigners(info: SmartWalletInfo): Promise<WalletSigners> {
  const result: WalletSigners = { passkeyCredentialIds: [], passkeys: [], hasRecoveryKey: false, recoveryRules: [] };
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
        result.passkeys.push({ credentialId, publicKey: new Uint8Array(keyData.subarray(0, 65)), ruleId: id });
      } else if (verifier === info.config.ed25519Verifier) {
        result.hasRecoveryKey = true;
        result.recoveryRules.push({ ruleId: id, publicKeyHex: Buffer.from(keyData).toString("hex") });
      }
    }
  }
  return result;
}

/**
 * The passkey to ask for when the wallet signs: the newest one on the wallet
 * that is still registered with Starlit, else any on the wallet (a passkey
 * removed from the Starlit account still lives on the user's phone).
 */
export function pickSigningPasskey(onChain: WalletPasskey[], registeredIds: string[]): WalletPasskey | null {
  const registered = onChain.filter((p) => registeredIds.includes(p.credentialId));
  return registered.at(-1) ?? onChain.at(-1) ?? null;
}

async function signingPasskey(info: SmartWalletInfo): Promise<{ signer: WalletPasskey; primary: WalletPasskey }> {
  const { passkeys } = await readWalletSigners(info);
  const signer = pickSigningPasskey(
    passkeys,
    info.passkeys.map((p) => p.credentialId)
  );
  if (!signer) throw new Error("This wallet has no passkey signer.");
  return { signer, primary: passkeys[0]! };
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
 * device, not just the one that created the wallet. It re-checks that record
 * on-chain, and that the passkey is a live signer on its rule.
 */
async function ensureWalletRecord(info: SmartWalletInfo, signer: WalletPasskey, primary: WalletPasskey) {
  const { credentialId } = signer;
  const stored = await kitStorage.get(credentialId);
  if (stored?.contractId === info.address && stored.creationTransactionHash && stored.creationLedger) return;
  const birth = info.birth ?? (await discoverBirth(info, primary.credentialId));
  const isPrimary = credentialId === primary.credentialId;
  const record = {
    contractId: info.address!,
    birthWasmHash: info.config.accountWasmHash,
    creationTransactionHash: birth.txHash,
    creationLedger: birth.ledger,
    deploymentStatus: "deployed" as const,
    isPrimary,
    // A later passkey can't prove the wallet's birth itself, so the kit needs
    // its rule and the hash of the wallet's constructor arguments.
    ...(isPrimary
      ? {}
      : {
          contextRuleId: signer.ruleId,
          associationVerified: true,
          birthConstructorArgsHash: await constructorArgsHash(info, birth.txHash),
        }),
  };
  if (stored) await kitStorage.update(credentialId, record);
  else await kitStorage.save({ credentialId, publicKey: signer.publicKey, nickname: "Starlit Pay", createdAt: Date.now(), ...record });
}

/** Hash of the wallet's constructor arguments, as smart-account-kit computes it. */
async function constructorArgsHash(info: SmartWalletInfo, creationTxHash: string): Promise<string> {
  const { envelope_xdr: envelope } = await horizon.transactions().transaction(creationTxHash).call();
  const tx = StellarSdk.TransactionBuilder.fromXDR(envelope, info.config.networkPassphrase) as StellarSdk.Transaction;
  const [operation] = tx.operations;
  if (operation?.type !== "invokeHostFunction") throw new Error("Could not read your public wallet's creation.");
  const args = operation.func.createContractV2().constructorArgs();
  return StellarSdk.hash(StellarSdk.xdr.ScVal.scvVec(args).toXDR()).toString("hex");
}

/** One rule id per authorised call, for a signer whose rule isn't the wallet's first. */
function signWithRule(ruleId: number) {
  return (entry: StellarSdk.xdr.SorobanAuthorizationEntry) =>
    Array.from({ length: countInvocations(entry.rootInvocation()) }, () => ruleId);
}

async function connectedKit(info: SmartWalletInfo) {
  const kit = await createKit(info);
  const { signer, primary } = await signingPasskey(info);
  await ensureWalletRecord(info, signer, primary);
  await kit.connectWallet({ contractId: info.address!, credentialId: signer.credentialId });
  const signing = { credentialId: signer.credentialId, resolveContextRuleIds: signWithRule(signer.ruleId) };
  return { kit, signing };
}

async function submitRecoveryRule(
  kit: SmartAccountKit,
  info: SmartWalletInfo,
  stellarPublicKey: string,
  signing?: Awaited<ReturnType<typeof connectedKit>>["signing"]
) {
  const backupKey = StellarSdk.Keypair.fromPublicKey(stellarPublicKey).rawPublicKey();
  const addRule = await kit.rules.add(
    createDefaultContext(),
    "Recovery",
    [createEd25519Signer(info.config.ed25519Verifier, backupKey)],
    new Map()
  );
  const added = await kit.signAndSubmitAdmin(addRule, signing);
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
  const { kit, signing } = await connectedKit(info);
  await submitRecoveryRule(kit, info, vaultKeys.stellar.publicKey, signing);
}

/**
 * Connects another of the user's passkeys to the wallet, as its own rule (one
 * rule with two signers would need both). A current wallet passkey approves it
 * or, if that is lost, the vault's recovery key. The address stays the same.
 */
export async function addPasskeyToWallet(credentialId: string, options: { useRecoveryKey?: boolean } = {}): Promise<void> {
  const info = await loadSmartWallet();
  if (!info.address) throw new Error("Create your public wallet first.");
  const passkey = info.passkeys.find((p) => p.credentialId === credentialId);
  if (!passkey) throw new NeedsWalletPasskeyError();
  if ((await readWalletSigners(info)).passkeyCredentialIds.includes(credentialId)) return;

  const func = addPasskeyRuleFunction(info, passkey.publicKey, credentialId);
  if (options.useRecoveryKey) {
    await submitWithRecoveryKey(info, func);
    return;
  }
  const { kit, signing } = await connectedKit(info);
  const tx = await assembleCall(info, info.address, "add_context_rule", func);
  const result = await kit.signAndSubmitAdmin(tx, signing);
  if (!result.success) throw failure(result, "The passkey could not be connected to your wallet.");
}

function addPasskeyRuleFunction(info: SmartWalletInfo, publicKeyB64u: string, credentialId: string) {
  const { xdr } = StellarSdk;
  const keyData = Buffer.concat([Buffer.from(fromB64u(publicKeyB64u)), Buffer.from(fromB64u(credentialId))]);
  const signer = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("External"),
    StellarSdk.Address.fromString(info.config.webauthnVerifier).toScVal(),
    xdr.ScVal.scvBytes(keyData),
  ]);
  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: StellarSdk.Address.fromString(info.address!).toScAddress(),
      functionName: "add_context_rule",
      args: [
        xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Default")]),
        xdr.ScVal.scvString("Passkey"),
        xdr.ScVal.scvVoid(),
        xdr.ScVal.scvVec([signer]),
        xdr.ScVal.scvMap([]),
      ],
    })
  );
}

async function assembleCall(info: SmartWalletInfo, contractId: string, method: string, func: StellarSdk.xdr.HostFunction) {
  const tx = await StellarSdk.contract.AssembledTransaction.buildWithOp(StellarSdk.Operation.invokeHostFunction({ func, auth: [] }), {
    contractId,
    networkPassphrase: info.config.networkPassphrase,
    rpcUrl: RPC_URL,
    method,
    parseResultXdr: (value: StellarSdk.xdr.ScVal) => value,
  });
  if (tx.simulation && StellarSdk.rpc.Api.isSimulationError(tx.simulation)) {
    throw new Error("The wallet action could not be prepared. Check your public wallet balance.");
  }
  return tx;
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

  status("Step 1 of 2: creating your wallet on Stellar…");
  await kit.credentials.save({ credentialId, publicKey: fromB64u(passkey.publicKey), nickname: "Starlit Pay" });
  const deployed = await kit.credentials.deploy(credentialId, { autoSubmit: true });
  if (!deployed.submitResult?.success) throw failure(deployed.submitResult ?? { success: false }, "The wallet could not be created.");

  status("Step 2 of 2: protecting it with your recovery code — approve with your passkey…");
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

  const { kit, signing } = await connectedKit(info);
  const result = await kit.transfer(tokenContract(info, token), recipient, amount, signing);
  if (!result.success) throw failure(result, "The payment could not be sent.");
  return result.hash ?? "";
}

/**
 * Sends the smart wallet's public funds to Starlit's gateway (public ->
 * private). The relay that submits it credits the user, and their device then
 * deposits the credit into the private pools. With `useRecoveryKey`, the
 * vault's backup key signs instead of the wallet passkey (lost passkey).
 */
export async function sendToGatewayFromSmartWallet(
  token: WalletToken,
  amount: number,
  gateway: string,
  options: { useRecoveryKey?: boolean } = {}
): Promise<string> {
  const info = await loadSmartWallet();
  if (!info.address) throw new Error("Create your public wallet first.");
  if (!(amount > 0)) throw new Error("Enter an amount greater than 0.");
  if (!options.useRecoveryKey) return sendFromSmartWallet(token, gateway, amount);

  const func = StellarSdk.xdr.HostFunction.hostFunctionTypeInvokeContract(
    new StellarSdk.xdr.InvokeContractArgs({
      contractAddress: StellarSdk.Address.fromString(tokenContract(info, token)).toScAddress(),
      functionName: "transfer",
      args: [
        StellarSdk.Address.fromString(info.address).toScVal(),
        StellarSdk.Address.fromString(gateway).toScVal(),
        StellarSdk.nativeToScVal(BigInt(Math.round(amount * 1e7)), { type: "i128" }),
      ],
    })
  );
  return submitWithRecoveryKey(info, func);
}

/** Number of authorised calls in an auth entry (the root call plus every nested one). */
function countInvocations(invocation: StellarSdk.xdr.SorobanAuthorizedInvocation): number {
  return 1 + invocation.subInvocations().reduce((sum, sub) => sum + countInvocations(sub), 0);
}

/**
 * Lost wallet passkey: the vault's backup key (unlocked by PIN, passkey or the
 * recovery code) signs the wallet's authorisation itself, through the wallet's
 * "Recovery" rule. No passkey and no smart-account-kit connection is needed.
 * The relayer submits it under the same rules as any wallet request.
 */
async function submitWithRecoveryKey(info: SmartWalletInfo, func: StellarSdk.xdr.HostFunction): Promise<string> {
  const vaultKeys = getUnlockedKeys();
  if (!vaultKeys) throw new Error("Unlock your wallet first.");
  const keypair = StellarSdk.Keypair.fromSecret(vaultKeys.stellar.secretKey);
  const ownKeyHex = Buffer.from(keypair.rawPublicKey()).toString("hex");
  const rule = (await readWalletSigners(info)).recoveryRules.find((r) => r.publicKeyHex === ownKeyHex);
  if (!rule) throw new Error("This wallet is not protected with your recovery code, so only its passkey can move the funds.");

  // Simulate to get the wallet's authorisation entry (recording mode).
  const { token } = await getSmartWalletRelayToken();
  const placeholder = new StellarSdk.Account(StellarSdk.Keypair.random().publicKey(), "0");
  const simTx = new StellarSdk.TransactionBuilder(placeholder, { fee: StellarSdk.BASE_FEE, networkPassphrase: info.config.networkPassphrase })
    .addOperation(StellarSdk.Operation.invokeHostFunction({ func, auth: [] }))
    .setTimeout(60)
    .build();
  const sim = await rpc.simulateTransaction(simTx);
  if (StellarSdk.rpc.Api.isSimulationError(sim) || !sim.result) {
    throw new Error("The transfer could not be prepared. Check your public wallet balance.");
  }

  const signer = new Ed25519Signer(keypair, info.config.ed25519Verifier);
  const expiration = (await rpc.getLatestLedger()).sequence + 100;
  const entries = sim.result.auth;
  for (const entry of entries) {
    const credentials = entry.credentials();
    if (credentials.switch().name !== "sorobanCredentialsAddress") continue;
    if (StellarSdk.Address.fromScAddress(credentials.address().address()).toString() !== info.address) continue;
    // One context rule id per authorised call (e.g. deposit + the token transfer inside it).
    const ruleIds = Array.from({ length: countInvocations(entry.rootInvocation()) }, () => rule.ruleId);
    const { authDigest } = computeEntryAuthDigest(info.config.networkPassphrase, entry, expiration, ruleIds);
    const signature = signer.signAuthDigest(authDigest);
    credentials.address().signature(
      StellarSdk.xdr.ScVal.scvMap([
        new StellarSdk.xdr.ScMapEntry({
          key: StellarSdk.xdr.ScVal.scvSymbol("context_rule_ids"),
          val: StellarSdk.xdr.ScVal.scvVec(ruleIds.map((id) => StellarSdk.xdr.ScVal.scvU32(id))),
        }),
        new StellarSdk.xdr.ScMapEntry({
          key: StellarSdk.xdr.ScVal.scvSymbol("signers"),
          val: StellarSdk.xdr.ScVal.scvMap([
            new StellarSdk.xdr.ScMapEntry({ key: signerToScVal(signer.signer), val: StellarSdk.xdr.ScVal.scvBytes(Buffer.from(signature)) }),
          ]),
        }),
      ])
    );
  }

  const res = await fetch(`${BACKEND_URL}/api/smart-wallet/relay/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ func: func.toXDR("base64"), auth: entries.map((e) => e.toXDR("base64")) }),
  });
  const body = (await res.json().catch(() => null)) as { success?: boolean; error?: string; data?: { hash?: string } } | null;
  if (!res.ok || !body?.success) throw new Error(body?.error || "The transfer could not be completed.");
  return body.data?.hash ?? "";
}
