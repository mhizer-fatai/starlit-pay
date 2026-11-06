import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "@stellar/stellar-sdk";
import { createZkGateway } from "../src/modules/zk_gateway/service.js";

const NP = S.Networks.TESTNET;
const gateway = S.Keypair.random();
const XLM_POOL = "CBPXO3XY6DVA4K6MU3K2JFYUOLUBFOMP2ACFFNVUP5LQZUZXFSTABPUX";
const USDC_POOL = "CBRXBWOEVQRNP7ZLGUTKG5UQBEFSOLLVHV4UEEVBKRPECB763YGHANLY";
const silent = { info() {}, warn() {}, error() {} };
const TX = "ab".repeat(32);

const extData = (amount) =>
  S.nativeToScVal(
    { encrypted_output0: Buffer.alloc(8, 1), encrypted_output1: Buffer.alloc(8, 2), ext_amount: amount, recipient: S.Address.fromString(gateway.publicKey()) },
    { type: { encrypted_output0: ["symbol", "bytes"], encrypted_output1: ["symbol", "bytes"], ext_amount: ["symbol", "i256"], recipient: ["symbol", "address"] } }
  );

// A deposit as the SDK builds it: gateway as source and sender, no expiry.
function deposit({ amount = 25_000_000n, pool = XLM_POOL, sender = gateway.publicKey(), seq = "1" } = {}) {
  return new S.TransactionBuilder(new S.Account(gateway.publicKey(), seq), { fee: "1000000", networkPassphrase: NP })
    .addOperation(new S.Contract(pool).call("transact", S.nativeToScVal(Buffer.alloc(4)), extData(amount), S.Address.fromString(sender).toScVal()))
    .setTimeout(0)
    .build()
    .toXDR();
}

function setup({ rows = [{ tx_hash: TX, op_index: 0, user_id: "u1", amount: "2.5000000", asset: "XLM", status: "credited", created_at: "2026-11-06T10:00:00Z" }] } = {}) {
  let clock = Date.parse("2026-11-06T12:00:00Z");
  const statuses = new Map();
  const find = (r) => rows.find((x) => x.tx_hash === r.tx_hash && x.op_index === r.op_index);
  const repository = {
    openCredits: async (userId) => rows.filter((r) => r.user_id === userId && ["credited", "claiming"].includes(r.status)).map((r) => ({ ...r })),
    getCredit: async (txHash, opIndex) => ({ ...find({ tx_hash: txHash, op_index: opIndex }) }),
    async startClaim(r, claim) {
      const row = find(r);
      if (row.status !== "credited") return false;
      return Object.assign(row, { status: "claiming", ...claim }), true;
    },
    async finishClaim(r) {
      const row = find(r);
      if (row.status !== "claiming" || row.claim_tx_hash !== r.claim_tx_hash) return false;
      return Object.assign(row, { status: "done", pool_tx_hash: r.claim_tx_hash }), true;
    },
    async reopenClaim(r) {
      const row = find(r);
      if (row.status !== "claiming" || row.claim_tx_hash !== r.claim_tx_hash) return false;
      return Object.assign(row, { status: "credited", claim_tx_hash: null, claim_expires_at: null }), true;
    },
  };
  const service = createZkGateway({
    gatewayKeypair: gateway,
    networkPassphrase: NP,
    poolsByAsset: { XLM: XLM_POOL, USDC: USDC_POOL },
    repository,
    transactionStatus: async (hash) => statuses.get(hash) ?? "NOT_FOUND",
    logger: silent,
    now: () => clock,
  });
  return { service, rows, statuses, advance: (ms) => (clock += ms) };
}

const id = `${TX}:0`;
const rejects = (promise, status) => assert.rejects(promise, (err) => err.status === status);

test("signs a deposit of exactly the credit into its pool, once, with a 5-minute expiry", async () => {
  const s = setup();
  const signed = S.TransactionBuilder.fromXDR(await s.service.sign("u1", id, deposit()), NP);
  assert.ok(gateway.verify(signed.hash(), signed.signatures[0].signature()));
  assert.equal(Number(signed.timeBounds.maxTime), Date.parse("2026-11-06T12:05:00Z") / 1000);
  assert.equal(s.rows[0].status, "claiming");
  assert.equal(s.rows[0].claim_tx_hash, signed.hash().toString("hex"));
  await rejects(s.service.sign("u1", id, deposit({ seq: "2" })), 409);
});

test("refuses other amounts, the wrong pool, another sender, and other users' credits", async () => {
  const s = setup();
  await rejects(s.service.sign("u1", id, deposit({ amount: 25_000_001n })), 403);
  await rejects(s.service.sign("u1", id, deposit({ amount: 24_999_999n })), 403);
  await rejects(s.service.sign("u1", id, deposit({ amount: -25_000_000n })), 403);
  await rejects(s.service.sign("u1", id, deposit({ pool: USDC_POOL })), 403);
  await rejects(s.service.sign("u1", id, deposit({ sender: S.Keypair.random().publicKey() })), 403);
  await rejects(s.service.sign("u2", id, deposit()), 404);
  assert.equal(s.rows[0].status, "credited", "nothing was claimed");
});

test("a claim whose deposit landed finishes the credit; it is never signed again", async () => {
  const s = setup();
  const signed = S.TransactionBuilder.fromXDR(await s.service.sign("u1", id, deposit()), NP);
  s.statuses.set(signed.hash().toString("hex"), "SUCCESS");
  assert.deepEqual(await s.service.list("u1"), []);
  assert.equal(s.rows[0].status, "done");
  await rejects(s.service.sign("u1", id, deposit({ seq: "2" })), 409);
});

test("a claim that can no longer land opens the credit again, but only after it expired", async () => {
  const s = setup();
  await s.service.sign("u1", id, deposit());
  s.advance(5 * 60_000); // expired, but a deposit might still be reported in the last ledgers
  assert.equal((await s.service.list("u1"))[0].status, "claiming");
  s.advance(61_000);
  assert.equal((await s.service.list("u1"))[0].status, "credited");
  await s.service.sign("u1", id, deposit({ seq: "2" }));
});

test("a failed deposit opens the credit again straight away", async () => {
  const s = setup();
  const signed = S.TransactionBuilder.fromXDR(await s.service.sign("u1", id, deposit()), NP);
  s.statuses.set(signed.hash().toString("hex"), "FAILED");
  const [credit] = await s.service.list("u1");
  assert.deepEqual(credit, { id, amount: "2.5000000", asset: "XLM", status: "credited", receivedAt: "2026-11-06T10:00:00Z" });
});

import { createMigrationCredits } from "../src/modules/zk_gateway/migration.js";

test("old-pool withdrawals to the gateway become the user's credit, once", async () => {
  const recorded = [];
  const repository = {
    async recordCredit(row) {
      if (recorded.some((r) => r.tx_hash === row.tx_hash)) return false;
      recorded.push(row);
      return true;
    },
  };
  const errors = [];
  const logger = { info() {}, warn() {}, error: (m) => errors.push(m) };
  let enabled = true;
  const record = createMigrationCredits({ repository, gatewayAddress: "GGATEWAY", tokens: { XLM: "CXLM", USDC: "CUSDC" }, enabled: () => enabled, logger });

  await record({ recipient: "GGATEWAY", token: "CXLM", amount: 2.3456789, hash: "h1", userId: "u1" });
  await record({ recipient: "GGATEWAY", token: "CXLM", amount: 2.3456789, hash: "h1", userId: "u1" });
  assert.deepEqual(recorded, [{ tx_hash: "h1", op_index: 0, memo: "migration", amount: "2.3456789", asset: "XLM", user_id: "u1" }]);

  await record({ recipient: "GSOMEONE", token: "CXLM", amount: 1, hash: "h2", userId: "u1" }); // an ordinary withdrawal
  enabled = false;
  await record({ recipient: "GGATEWAY", token: "CUSDC", amount: 1, hash: "h3", userId: "u1" }); // older pool still in use
  assert.equal(recorded.length, 1);

  enabled = true;
  await record({ recipient: "GGATEWAY", token: "CUSDC", amount: 1, hash: "h4" }); // no user: needs a person
  assert.equal(recorded.length, 1);
  assert.equal(errors.length, 1);
});
