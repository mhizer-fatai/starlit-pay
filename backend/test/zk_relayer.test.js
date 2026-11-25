import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "@stellar/stellar-sdk";
import { createZkRelayer } from "../src/modules/zk_relayer/service.js";
import { ComplianceUnavailableError } from "../src/compliance.js";
import { createChannelPool, deriveChannelKeypairs } from "../src/channels.js";

const NP = S.Networks.TESTNET;
const relayer = S.Keypair.random();
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

function transact({ pool = POOL, fn = "transact", amount = 0n, sender = relayer.publicKey(), source = relayer.publicKey(), fee = "1000000", timeout = 300, ops = 1, auth } = {}) {
  const builder = new S.TransactionBuilder(new S.Account(source, "1"), { fee, networkPassphrase: NP });
  for (let i = 0; i < ops; i++) {
    const op = new S.Contract(pool).call(fn, S.nativeToScVal(Buffer.alloc(4)), extData(amount), S.Address.fromString(sender).toScVal());
    if (auth) op.body().invokeHostFunctionOp().auth(auth);
    builder.addOperation(op);
  }
  return builder.setTimeout(timeout).build().toXDR();
}

function service({ blocked = false, screenError = null } = {}) {
  return createZkRelayer({
    relayerKeypair: relayer,
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

test("signs a private transfer: one transact call to our pool, paid and sent by the relayer", async () => {
  const signed = S.TransactionBuilder.fromXDR(await service().sign(transact(), "u1"), NP);
  assert.equal(signed.signatures.length, 1);
  assert.ok(relayer.verify(signed.hash(), signed.signatures[0].signature()));
});

test("signs a withdrawal to a screened recipient", async () => {
  await service().sign(transact({ amount: -5_000_000n }), "u1");
});

test("never sponsors a deposit (it would pull the relayer's own tokens)", async () => {
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
});

test("a transaction without an expiry (as SPP builds them) gets a 5-minute one from the relayer", async () => {
  const signed = S.TransactionBuilder.fromXDR(await service().sign(transact({ timeout: 0 }), "u1"), NP);
  const left = Number(signed.timeBounds.maxTime) - Math.floor(Date.now() / 1000);
  assert.ok(left > 290 && left <= 300, `expires in ${left}s`);
  assert.ok(relayer.verify(signed.hash(), signed.signatures[0].signature()));
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
  inner.sign(relayer);
  const bump = S.TransactionBuilder.buildFeeBumpTransaction(relayer, "2000000", inner, NP);
  await refused(service().sign(bump.toXDR(), "u1"));
  await refused(service().sign("AAAA", "u1"), 400);
});

test("without a relayer key, private payments say they're not configured", async () => {
  const off = createZkRelayer({ relayerKeypair: null, networkPassphrase: NP, pools: [POOL], isAddressBlocked: async () => false, logger: silent });
  assert.equal(off.address, null);
  await refused(off.sign(transact(), "u1"), 503);
});

// --- Channels: each payment is signed by a channel leased to that user.

function withChannels(count = 2) {
  const channels = createChannelPool({ keypairs: deriveChannelKeypairs(relayer, count), transactionStatus: async () => "NOT_FOUND" });
  channels.setReady();
  const svc = createZkRelayer({ relayerKeypair: relayer, channels, networkPassphrase: NP, pools: [POOL, OTHER], isAddressBlocked: async () => false, logger: silent });
  return { svc, channels };
}

test("with channels, each user's payment is signed by the channel leased to them", async () => {
  const { svc } = withChannels();
  const ada = await svc.lease("ada");
  const sam = await svc.lease("sam");
  assert.notEqual(ada.address, sam.address);
  assert.notEqual(ada.address, relayer.publicKey());

  const xdr = transact({ sender: ada.address, source: ada.address });
  const signed = S.TransactionBuilder.fromXDR(await svc.sign(xdr, "ada", ada.leaseId), NP);
  assert.ok(S.Keypair.fromPublicKey(ada.address).verify(signed.hash(), signed.signatures[0].signature()));
});

test("a channel lease can't be used by someone else, or for another channel's transaction", async () => {
  const { svc } = withChannels();
  const ada = await svc.lease("ada");
  const sam = await svc.lease("sam");
  await refused(svc.sign(transact({ sender: ada.address, source: ada.address }), "sam", ada.leaseId), 409);
  await refused(svc.sign(transact({ sender: sam.address, source: sam.address }), "ada", ada.leaseId));
});

test("the same safety rules apply on channels: no deposits, no other contracts", async () => {
  const { svc } = withChannels();
  const ada = await svc.lease("ada");
  await refused(svc.sign(transact({ sender: ada.address, source: ada.address, amount: 1n }), "ada", ada.leaseId));
  await refused(svc.sign(transact({ sender: ada.address, source: ada.address, pool: NOT_OURS }), "ada", ada.leaseId));
});

test("when every channel is busy, the next relayer is told to try again in a moment", async () => {
  const { svc } = withChannels(1);
  await svc.lease("ada");
  await assert.rejects(svc.lease("sam"), (err) => err.status === 503 && err.code === "CHANNELS_BUSY");
});

test("without channels, the relayer itself is leased, as before", async () => {
  const lease = await service().lease("ada");
  assert.deepEqual(lease, { leaseId: null, address: relayer.publicKey() });
});

test("channels aren't used until they exist on the network; the relayer carries on meanwhile", async () => {
  const channels = createChannelPool({ keypairs: deriveChannelKeypairs(relayer, 2), transactionStatus: async () => "NOT_FOUND" });
  const svc = createZkRelayer({ relayerKeypair: relayer, channels, networkPassphrase: NP, pools: [POOL, OTHER], isAddressBlocked: async () => false, logger: silent });
  assert.deepEqual(await svc.lease("ada"), { leaseId: null, address: relayer.publicKey() });
  channels.setReady();
  assert.notEqual((await svc.lease("ada")).address, relayer.publicKey());
});
