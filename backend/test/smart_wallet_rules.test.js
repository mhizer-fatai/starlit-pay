import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as S from "@stellar/stellar-sdk";
import { checkRelayRequest, deployedContractId, rawP256FromCose } from "../src/smart_wallet_rules.js";
import { createSoftAuthenticator } from "./helpers/soft_authenticator.js";

const { xdr, Address } = S;
const NP = S.Networks.TESTNET;
const DEPLOYER = "GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N";
const WASM = "1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a";
const VERIFIER = "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F";
const XLM = S.Asset.native().contractId(NP);
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const POOL = "CAHSOWD7JVCRO4U73MGXRET7DRJDM3K2CFS5EGYARWDEGACHWSR6ZEZM";

const randomContract = () => S.StrKey.encodeContract(crypto.randomBytes(32));
const p256 = () => Buffer.concat([Buffer.from([4]), crypto.randomBytes(64)]);

function authFor(address) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(address).toScAddress(),
        nonce: xdr.Int64.fromString("1"),
        signatureExpirationLedger: 100,
        signature: xdr.ScVal.scvVoid(),
      })
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({ contractAddress: new Address(XLM).toScAddress(), functionName: "x", args: [] })
      ),
      subInvocations: [],
    }),
  });
}
const sourceAccountAuth = () =>
  new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: authFor(DEPLOYER).rootInvocation(),
  });

function deployPayload({ deployer = DEPLOYER, wasm = WASM, signers, policies = [], auth } = {}) {
  const preimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
    new xdr.ContractIdPreimageFromAddress({ address: new Address(deployer).toScAddress(), salt: crypto.randomBytes(32) })
  );
  const func = xdr.HostFunction.hostFunctionTypeCreateContractV2(
    new xdr.CreateContractArgsV2({
      contractIdPreimage: preimage,
      executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(wasm, "hex")),
      constructorArgs: [xdr.ScVal.scvVec(signers), xdr.ScVal.scvMap(policies)],
    })
  );
  return { func: func.toXDR("base64"), auth: (auth ?? [authFor(deployer)]).map((a) => a.toXDR("base64")), preimage };
}

const passkeySigner = (pub, credentialId, verifier = VERIFIER) =>
  xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("External"),
    new Address(verifier).toScVal(),
    xdr.ScVal.scvBytes(Buffer.concat([pub, Buffer.from(credentialId, "base64url")])),
  ]);

function invokePayload({ contract, fn, args, authBy }) {
  const func = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({ contractAddress: new Address(contract).toScAddress(), functionName: fn, args })
  );
  return { func: func.toXDR("base64"), auth: authBy.map((a) => authFor(a).toXDR("base64")) };
}

function context(overrides = {}) {
  const credentialId = crypto.randomBytes(20).toString("base64url");
  const rawPublicKey = p256();
  return {
    walletAddress: null,
    passkeys: [{ id: "pk-1", credentialId, rawPublicKey }],
    deployer: DEPLOYER,
    accountWasmHash: WASM,
    webauthnVerifier: VERIFIER,
    tokens: [XLM, USDC],
    poolContract: POOL,
    networkPassphrase: NP,
    ...overrides,
  };
}

describe("deploying a wallet", () => {
  test("accepts the canonical wallet with the user's own ES256 passkey", () => {
    const ctx = context();
    const { credentialId, rawPublicKey } = ctx.passkeys[0];
    const payload = deployPayload({ signers: [passkeySigner(rawPublicKey, credentialId)] });
    const result = checkRelayRequest(payload, ctx);
    assert.equal(result.kind, "deploy");
    assert.equal(result.passkeyId, "pk-1");
    assert.equal(result.contractId, deployedContractId(NP, payload.preimage));
  });

  test("refuses another account's passkey, a wrong key, or a non-ES256 passkey", () => {
    const ctx = context();
    const { credentialId, rawPublicKey } = ctx.passkeys[0];
    const cases = [
      passkeySigner(p256(), crypto.randomBytes(20).toString("base64url")), // unknown passkey
      passkeySigner(p256(), credentialId), // right id, wrong key
    ];
    for (const signer of cases) assert.throws(() => checkRelayRequest(deployPayload({ signers: [signer] }), ctx), /registered to this account/);
    const rsaOnly = context({ passkeys: [{ id: "pk-rsa", credentialId, rawPublicKey: null }] });
    assert.throws(() => checkRelayRequest(deployPayload({ signers: [passkeySigner(rawPublicKey, credentialId)] }), rsaOnly), /ES256/);
  });

  test("refuses other code, deployers, verifiers, extra signers, policies, or a second wallet", () => {
    const ctx = context();
    const { credentialId, rawPublicKey } = ctx.passkeys[0];
    const ok = passkeySigner(rawPublicKey, credentialId);
    assert.throws(() => checkRelayRequest(deployPayload({ signers: [ok], wasm: "00".repeat(32) }), ctx), /canonical/);
    const otherDeployer = S.Keypair.random().publicKey();
    assert.throws(() => checkRelayRequest(deployPayload({ signers: [ok], deployer: otherDeployer }), ctx), /deployer/);
    assert.throws(() => checkRelayRequest(deployPayload({ signers: [passkeySigner(rawPublicKey, credentialId, randomContract())] }), ctx), /WebAuthn verifier/);
    assert.throws(() => checkRelayRequest(deployPayload({ signers: [ok, ok] }), ctx), /exactly one/);
    const policy = [new xdr.ScMapEntry({ key: new Address(randomContract()).toScVal(), val: xdr.ScVal.scvVoid() })];
    assert.throws(() => checkRelayRequest(deployPayload({ signers: [ok], policies: policy }), ctx), /Policies/);
    assert.throws(() => checkRelayRequest(deployPayload({ signers: [ok] }), { ...ctx, walletAddress: randomContract() }), /already has/);
  });
});

describe("spending from the wallet", () => {
  const wallet = randomContract();
  const ctx = context({ walletAddress: wallet });
  const amount = new S.XdrLargeInt("i128", 50_000_000n).toI128();

  test("sponsors XLM and USDC transfers from the user's own wallet", () => {
    for (const token of [XLM, USDC]) {
      const payload = invokePayload({
        contract: token,
        fn: "transfer",
        args: [new Address(wallet).toScVal(), new Address(S.Keypair.random().publicKey()).toScVal(), amount],
        authBy: [wallet],
      });
      assert.equal(checkRelayRequest(payload, ctx).kind, "transfer");
    }
  });

  test("refuses transfers from anyone else, other tokens, or other functions", () => {
    const other = randomContract();
    const to = new Address(S.Keypair.random().publicKey()).toScVal();
    assert.throws(() => checkRelayRequest(invokePayload({ contract: XLM, fn: "transfer", args: [new Address(other).toScVal(), to, amount], authBy: [other] }), ctx), /your smart wallet/);
    assert.throws(() => checkRelayRequest(invokePayload({ contract: XLM, fn: "transfer", args: [new Address(other).toScVal(), to, amount], authBy: [wallet] }), ctx), /own smart wallet/);
    assert.throws(() => checkRelayRequest(invokePayload({ contract: randomContract(), fn: "transfer", args: [new Address(wallet).toScVal(), to, amount], authBy: [wallet] }), ctx), /not sponsored/);
    assert.throws(() => checkRelayRequest(invokePayload({ contract: XLM, fn: "approve", args: [new Address(wallet).toScVal(), to, amount], authBy: [wallet] }), ctx), /not sponsored/);
  });

  test("sponsors shielded pool deposits from the user's own wallet only", () => {
    const deposit = (from, token = XLM) =>
      invokePayload({
        contract: POOL,
        fn: "deposit",
        args: [new Address(from).toScVal(), new Address(token).toScVal(), amount, xdr.ScVal.scvBytes(Buffer.alloc(32)), xdr.ScVal.scvBytes(Buffer.alloc(1))],
        authBy: [from],
      });
    assert.equal(checkRelayRequest(deposit(wallet), ctx).kind, "pool-deposit");
    assert.equal(checkRelayRequest(deposit(wallet, USDC), ctx).kind, "pool-deposit");
    const other = randomContract();
    assert.throws(() => checkRelayRequest(deposit(other), ctx), /your smart wallet/);
    assert.throws(() => checkRelayRequest({ ...deposit(other), auth: deposit(wallet).auth }, ctx), /own smart wallet/);
    assert.throws(() => checkRelayRequest(deposit(wallet, randomContract()), ctx), /not sponsored/);
    const withdraw = invokePayload({ contract: POOL, fn: "withdraw", args: [], authBy: [wallet] });
    assert.throws(() => checkRelayRequest(withdraw, ctx), /not sponsored/);
  });

  test("sponsors admin calls on the user's own wallet (e.g. adding the backup signer)", () => {
    const payload = invokePayload({ contract: wallet, fn: "add_signer", args: [], authBy: [wallet] });
    assert.deepEqual({ kind: checkRelayRequest(payload, ctx).kind }, { kind: "wallet-admin" });
  });

  test("needs a wallet first", () => {
    const payload = invokePayload({ contract: wallet, fn: "add_signer", args: [], authBy: [wallet] });
    assert.throws(() => checkRelayRequest(payload, context()), /Create your smart wallet first/);
  });
});

describe("always refused", () => {
  test("source-account authorization (would let the request spend the relayer's funds)", () => {
    const wallet = randomContract();
    const payload = invokePayload({ contract: XLM, fn: "transfer", args: [], authBy: [] });
    payload.auth = [sourceAccountAuth().toXDR("base64")];
    assert.throws(() => checkRelayRequest(payload, context({ walletAddress: wallet })), /Source-account/);
  });

  test("malformed or empty requests", () => {
    assert.throws(() => checkRelayRequest({}, context()), /Expected/);
    assert.throws(() => checkRelayRequest({ func: "AAAA", auth: [] }, context()), /authorization/);
    assert.throws(() => checkRelayRequest({ func: "not-xdr", auth: ["x"] }, context()), /Malformed/);
  });
});

describe("passkey key types", () => {
  test("extracts the raw P-256 key from an ES256 passkey", async () => {
    const authenticator = createSoftAuthenticator();
    const reg = authenticator.register({
      challenge: crypto.randomBytes(32).toString("base64url"),
      user: { id: crypto.randomBytes(16).toString("base64url") },
    });
    // COSE key = the attested credential public key inside the attestation object
    const att = Buffer.from(reg.response.attestationObject, "base64url");
    const authDataStart = att.indexOf(Buffer.from("authData")) + "authData".length + 2;
    const credIdLen = att.readUInt16BE(authDataStart + 37 + 16);
    const cose = att.subarray(authDataStart + 37 + 18 + credIdLen);
    const raw = rawP256FromCose(cose.toString("base64url"));
    assert.ok(raw && raw.length === 65 && raw[0] === 4);
    const spki = crypto.createPublicKey({ key: Buffer.from(reg.response.publicKey, "base64url"), format: "der", type: "spki" });
    assert.equal(Buffer.from(spki.export({ format: "jwk" }).x, "base64url").toString("hex"), raw.subarray(1, 33).toString("hex"));
  });

  test("returns null for non-ES256 keys", () => {
    assert.equal(rawP256FromCose("not-a-key"), null);
  });
});
