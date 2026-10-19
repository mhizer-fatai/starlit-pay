import * as StellarSdk from "@stellar/stellar-sdk";
import { decodeCredentialPublicKey } from "@simplewebauthn/server/helpers";

// Rules for what the Starlit relayer will pay fees for on behalf of a user's
// smart wallet (OpenZeppelin smart account via smart-account-kit). Pure
// functions: they inspect the requested host function and auth entries and
// either describe the request or throw.
//
// Sponsored, and nothing else:
//   deploy        the canonical smart-account WASM via the shared deployer, with
//                 exactly one signer: an ES256 passkey this user registered with
//                 us, and no policies (one wallet per user)
//   transfer      XLM or USDC transfer() whose `from` is the user's own wallet
//   wallet-admin  any call on the user's own wallet (e.g. add the backup signer);
//                 only the wallet's own signers can authorise it
//
// Always refused: source-account authorization (it would make the relayer, as
// transaction source, authorise something with its own funds).

const { xdr, Address, StrKey } = StellarSdk;

export class RelayRuleError extends Error {
  constructor(message) {
    super(message);
    this.name = "RelayRuleError";
  }
}

/** The 65-byte uncompressed P-256 key of an ES256 passkey, or null for other key types (e.g. RS256). */
export function rawP256FromCose(coseB64u) {
  try {
    const cose = decodeCredentialPublicKey(new Uint8Array(Buffer.from(coseB64u, "base64url")));
    if (cose.get(3) !== -7 || cose.get(1) !== 2 || cose.get(-1) !== 1) return null;
    const x = cose.get(-2);
    const y = cose.get(-3);
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) return null;
    return Buffer.concat([Buffer.from([0x04]), Buffer.from(x), Buffer.from(y)]);
  } catch {
    return null;
  }
}

/** Contract address a createContractV2-from-address deployment will get. */
export function deployedContractId(networkPassphrase, contractIdPreimage) {
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({ networkId: StellarSdk.hash(Buffer.from(networkPassphrase)), contractIdPreimage })
  );
  return StrKey.encodeContract(StellarSdk.hash(preimage.toXDR()));
}

function decode(payload) {
  if (!payload || typeof payload.func !== "string" || !Array.isArray(payload.auth)) {
    throw new RelayRuleError("Expected { func, auth }.");
  }
  if (payload.auth.length === 0 || payload.auth.length > 4) throw new RelayRuleError("Unexpected authorization entries.");
  let func;
  let auth;
  try {
    func = xdr.HostFunction.fromXDR(payload.func, "base64");
    auth = payload.auth.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64"));
  } catch {
    throw new RelayRuleError("Malformed transaction parts.");
  }
  for (const entry of auth) {
    if (entry.credentials().switch().name !== "sorobanCredentialsAddress") {
      throw new RelayRuleError("Source-account authorization is never sponsored.");
    }
  }
  return { func, auth };
}

const authAddresses = (auth) => auth.map((e) => Address.fromScAddress(e.credentials().address().address()).toString());

function checkDeploy(func, auth, ctx) {
  if (ctx.walletAddress) throw new RelayRuleError("This account already has a smart wallet.");
  const create = func.createContractV2();
  const preimage = create.contractIdPreimage();
  if (preimage.switch().name !== "contractIdPreimageFromAddress") throw new RelayRuleError("Unexpected deployment type.");
  const deployer = Address.fromScAddress(preimage.fromAddress().address()).toString();
  if (deployer !== ctx.deployer) throw new RelayRuleError("Unexpected deployer.");
  const exe = create.executable();
  if (exe.switch().name !== "contractExecutableWasm" || exe.wasmHash().toString("hex") !== ctx.accountWasmHash) {
    throw new RelayRuleError("Only the canonical smart-account contract can be deployed.");
  }
  if (authAddresses(auth).some((a) => a !== ctx.deployer)) throw new RelayRuleError("Unexpected signer on the deployment.");

  const args = create.constructorArgs();
  if (args.length !== 2) throw new RelayRuleError("Unexpected constructor arguments.");
  const signers = StellarSdk.scValToNative(args[0]);
  const policies = StellarSdk.scValToNative(args[1]);
  if (!Array.isArray(signers) || signers.length !== 1) throw new RelayRuleError("A new wallet must have exactly one passkey signer.");
  if (policies && Object.keys(policies).length > 0) throw new RelayRuleError("Policies are not sponsored at creation.");

  const [kind, verifier, keyData] = signers[0];
  if (kind !== "External" || verifier !== ctx.webauthnVerifier || !Buffer.isBuffer(keyData)) {
    throw new RelayRuleError("The signer must be a passkey checked by the WebAuthn verifier.");
  }
  const publicKey = keyData.subarray(0, 65);
  const credentialId = keyData.subarray(65).toString("base64url");
  const passkey = ctx.passkeys.find((p) => p.credentialId === credentialId);
  if (!passkey || !passkey.rawPublicKey || !passkey.rawPublicKey.equals(publicKey)) {
    throw new RelayRuleError("The wallet passkey must be an ES256 passkey registered to this account.");
  }
  return { kind: "deploy", contractId: deployedContractId(ctx.networkPassphrase, preimage), passkeyId: passkey.id };
}

function checkInvoke(func, auth, ctx) {
  if (!ctx.walletAddress) throw new RelayRuleError("Create your smart wallet first.");
  const call = func.invokeContract();
  const target = Address.fromScAddress(call.contractAddress()).toString();
  const fn = call.functionName().toString();
  const signers = authAddresses(auth);
  if (signers.some((a) => a !== ctx.walletAddress)) throw new RelayRuleError("Only your smart wallet may authorise sponsored calls.");

  if (target === ctx.walletAddress) return { kind: "wallet-admin", fn };

  if (ctx.tokens.includes(target) && fn === "transfer") {
    const from = Address.fromScVal(call.args()[0]).toString();
    if (from !== ctx.walletAddress) throw new RelayRuleError("Transfers must come from your own smart wallet.");
    return { kind: "transfer", token: target };
  }
  throw new RelayRuleError("This action is not sponsored.");
}

/**
 * ctx: { walletAddress|null, passkeys: [{id, credentialId, rawPublicKey|null}], deployer,
 *        accountWasmHash, webauthnVerifier, tokens: [SAC ids], networkPassphrase }
 */
export function checkRelayRequest(payload, ctx) {
  const { func, auth } = decode(payload);
  switch (func.switch().name) {
    case "hostFunctionTypeCreateContractV2":
      return { ...checkDeploy(func, auth, ctx), func, auth };
    case "hostFunctionTypeInvokeContract":
      return { ...checkInvoke(func, auth, ctx), func, auth };
    default:
      throw new RelayRuleError("This action is not sponsored.");
  }
}
