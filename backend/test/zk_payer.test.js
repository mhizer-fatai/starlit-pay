import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "@stellar/stellar-sdk";
import { createZkPayer } from "../src/modules/zk_payer/service.js";
import { ComplianceUnavailableError } from "../src/compliance.js";

const NP = S.Networks.TESTNET;
const payer = S.Keypair.random();
const POOL = "CBPXO3XY6DVA4K6MU3K2JFYUOLUBFOMP2ACFFNVUP5LQZUZXFSTABPUX";
const OTHER = "CBRXBWOEVQRNP7ZLGUTKG5UQBEFSOLLVHV4UEEVBKRPECB763YGHANLY";
const NOT_OURS = S.StrKey.encodeContract(Buffer.alloc(32, 5));
const silent = { info() {}, warn() {}, error() {} };
const recipient = S.Keypair.random().publicKey();

const extData = (amount, to = recipient) =>
  S.nativeToScVal(
    { encrypted_output0: Buffer.alloc(8, 1), encrypted_output1: Buffer.alloc(8, 2), ext_amount: amount, recipient: S.Address.fromString(to) },
    { type: { encrypted_output0: ["symbol", "bytes"], encrypted_output1: ["symbol", "bytes"], ext_amount: ["symbol", "i256"], recipient: ["symbol", "address"] } }
  );

function transact({ pool = POOL, fn = "transact", amount = 0n, sender = payer.publicKey(), source = payer.publicKey(), fee = "1000000", timeout = 300, ops = 1, auth } = {}) {
  const builder = new S.TransactionBuilder(new S.Account(source, "1"), { fee, networkPassphrase: NP });
  for (let i = 0; i < ops; i++) {
    const op = new S.Contract(pool).call(fn, S.nativeToScVal(Buffer.alloc(4)), extData(amount), S.Address.fromString(sender).toScVal());
    if (auth) op.body().invokeHostFunctionOp().auth(auth);
    builder.addOperation(op);
  }
  return builder.setTimeout(timeout).build().toXDR();
}

function service({ blocked = false, screenError = null } = {}) {
  return createZkPayer({
    payerKeypair: payer,
    networkPassphrase: NP,
    pools: [POOL, OTHER],
    isAddressBlocked: async (address, opts) => {
      assert.equal(opts.failClosed, true);
      if (screenError) throw screenError;
      return blocked;
    },
    logger: silent,
  });
}

const refused = async (promise, status = 403) => assert.rejects(promise, (err) => err.status === status);

test("signs a private transfer: one transact call to our pool, paid and sent by the payer", async () => {
  const signed = S.TransactionBuilder.fromXDR(await service().sign(transact(), "u1"), NP);
  assert.equal(signed.signatures.length, 1);
  assert.ok(payer.verify(signed.hash(), signed.signatures[0].signature()));
});

test("signs a withdrawal to a screened recipient", async () => {
  await service().sign(transact({ amount: -5_000_000n }), "u1");
});

test("never sponsors a deposit (it would pull the payer's own tokens)", async () => {
  await refused(service().sign(transact({ amount: 1n }), "u1"));
});

test("refuses other contracts, other functions and a different sender or source", async () => {
  await refused(service().sign(transact({ pool: NOT_OURS }), "u1"));
  await refused(service().sign(transact({ fn: "claim_fees" }), "u1"));
  await refused(service().sign(transact({ sender: S.Keypair.random().publicKey() }), "u1"));
  await refused(service().sign(transact({ source: S.Keypair.random().publicKey() }), "u1"));
});

test("refuses extra operations, high fees and long-lived transactions", async () => {
  await refused(service().sign(transact({ ops: 2 }), "u1"));
  await refused(service().sign(transact({ fee: "60000000" }), "u1"));
  await refused(service().sign(transact({ timeout: 3600 }), "u1"));
  await refused(service().sign(transact({ timeout: 0 }), "u1"));
});

test("refuses authorizations from any account other than the source", async () => {
  const someone = S.Keypair.random().publicKey();
  const entry = new S.xdr.SorobanAuthorizationEntry({
    credentials: S.xdr.SorobanCredentials.sorobanCredentialsAddress(
      new S.xdr.SorobanAddressCredentials({ address: S.Address.fromString(someone).toScAddress(), nonce: S.xdr.Int64.fromString("1"), signatureExpirationLedger: 10, signature: S.xdr.ScVal.scvVoid() })
    ),
    rootInvocation: new S.xdr.SorobanAuthorizedInvocation({
      function: S.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new S.xdr.InvokeContractArgs({ contractAddress: S.Address.fromString(POOL).toScAddress(), functionName: "transact", args: [] })
      ),
      subInvocations: [],
    }),
  });
  await refused(service().sign(transact({ auth: [entry] }), "u1"));
});

test("withdrawals to blocked recipients are refused, and screening outages fail closed", async () => {
  await refused(service({ blocked: true }).sign(transact({ amount: -1n }), "u1"));
  await refused(service({ screenError: new ComplianceUnavailableError("G", new Error("down")) }).sign(transact({ amount: -1n }), "u1"), 503);
});

test("refuses fee bumps and garbage", async () => {
  const inner = S.TransactionBuilder.fromXDR(transact(), NP);
  inner.sign(payer);
  const bump = S.TransactionBuilder.buildFeeBumpTransaction(payer, "2000000", inner, NP);
  await refused(service().sign(bump.toXDR(), "u1"));
  await refused(service().sign("AAAA", "u1"), 400);
});

test("without a payer key, private payments say they're not configured", async () => {
  const off = createZkPayer({ payerKeypair: null, networkPassphrase: NP, pools: [POOL], isAddressBlocked: async () => false, logger: silent });
  assert.equal(off.address, null);
  await refused(off.sign(transact(), "u1"), 503);
});
