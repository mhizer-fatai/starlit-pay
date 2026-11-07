import { test } from "node:test";
import assert from "node:assert/strict";
import * as StellarSdk from "@stellar/stellar-sdk";
import { createDepositProcessor, MAX_ATTEMPTS } from "../src/modules/gateway/service.js";
import { createGatewayDaemon } from "../src/modules/gateway/daemon.js";

const PASSPHRASE = StellarSdk.Networks.TESTNET;
const gateway = StellarSdk.Keypair.random();
const sender = StellarSdk.Keypair.random();
const silent = { info() {}, warn() {}, error() {} };
const LIMITS = { minDeposit: 1_000_000n, maxDeposit: 500_000_000_000n };

function paymentRecord({ amounts = ["50"], memo = "7", memoType = "id", destination = gateway.publicKey(), seq = "100", feeBump = false } = {}) {
  const builder = new StellarSdk.TransactionBuilder(new StellarSdk.Account(sender.publicKey(), seq), { fee: "100", networkPassphrase: PASSPHRASE });
  for (const amount of amounts) builder.addOperation(StellarSdk.Operation.payment({ destination, asset: StellarSdk.Asset.native(), amount }));
  if (memo !== null) builder.addMemo(memoType === "id" ? StellarSdk.Memo.id(memo) : StellarSdk.Memo.text(memo));
  let tx = builder.setTimeout(0).build();
  tx.sign(sender);
  if (feeBump) {
    tx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(sender, "200", tx, PASSPHRASE);
    tx.sign(sender);
  }
  return { hash: tx.hash().toString("hex"), envelope_xdr: tx.toXDR(), memo, memo_type: memo === null ? "none" : memoType, paging_token: `pt-${seq}` };
}

function setup({ blocked = false } = {}) {
  let clock = Date.parse("2026-11-07T12:00:00Z");
  const rows = new Map();
  const users = new Map([[7, { id: "u1", username: "alice" }]]);
  const id = ({ txHash, opIndex }) => `${txHash}:${opIndex}`;
  const stamp = () => new Date(clock).toISOString();

  const repository = {
    findUserByMemo: async (memo) => users.get(memo) ?? null,
    async claim(key, details) {
      if (rows.has(id(key))) return false;
      rows.set(id(key), { ...details, status: "processing", attempts: 1, updated_at: stamp() });
      return true;
    },
    get: async (key) => ({ ...rows.get(id(key)) }),
    async takeOver(key, row) {
      const current = rows.get(id(key));
      if (current.updated_at !== row.updated_at) return false;
      Object.assign(current, { status: "processing", attempts: row.attempts + 1, updated_at: stamp() });
      return true;
    },
    async update(key, fields) {
      Object.assign(rows.get(id(key)), fields, { updated_at: stamp() });
    },
    listRetryable: async (staleBefore, max) =>
      [...rows].filter(([, r]) => r.status === "processing" && r.updated_at < staleBefore && r.attempts <= max).map(([k]) => k.split(":")[0]),
  };

  const records = new Map();
  const chain = { fetchTransaction: async (hash) => records.get(hash) };
  const processor = createDepositProcessor({
    repository,
    chain,
    isAddressBlocked: async () => blocked,
    gatewayAddress: gateway.publicKey(),
    networkPassphrase: PASSPHRASE,
    limits: LIMITS,
    logger: silent,
    now: () => clock,
  });
  const credited = () => [...rows.values()].filter((r) => r.status === "credited");
  return { processor, rows, records, credited, advance: (ms) => (clock += ms) };
}

test("a payment becomes the user's credit once, however often it is seen", async () => {
  const s = setup();
  const record = paymentRecord({ amounts: ["2.5"] });
  const first = await s.processor.processTransaction(record);
  assert.equal(first.operations[0].credited, true);
  assert.equal((await s.processor.processTransaction(record)).operations[0].reason, "already_processed");
  assert.deepEqual(s.credited().map((r) => [r.user_id, r.amount, r.asset]), [["u1", "2.5000000", "XLM"]]);
});

test("two simultaneous attempts (daemon and endpoint) credit once", async () => {
  const s = setup();
  const record = paymentRecord();
  await Promise.all([s.processor.processTransaction(record), s.processor.processTransaction(record)]);
  assert.equal(s.credited().length, 1);
});

test("blocked senders and amounts outside the pools' limits are set aside, never credited", async () => {
  const blocked = setup({ blocked: true });
  await blocked.processor.processTransaction(paymentRecord());
  assert.equal([...blocked.rows.values()][0].status, "needs_review");

  const tiny = setup();
  await tiny.processor.processTransaction(paymentRecord({ amounts: ["0.05"] }));
  assert.equal([...tiny.rows.values()][0].status, "needs_review");
  assert.equal(tiny.credited().length, 0);
});

test("a payment interrupted mid-way is retried once stale, and set aside after too many tries", async () => {
  const s = setup();
  const record = paymentRecord();
  s.records.set(record.hash, record);
  // Recorded, then the process died before crediting.
  s.rows.set(`${record.hash}:0`, { memo: "7", amount: "50", asset: "XLM", status: "processing", attempts: 1, updated_at: new Date(Date.parse("2026-11-07T12:00:00Z")).toISOString() });
  await s.processor.retryStalled();
  assert.equal(s.credited().length, 0, "not stale yet");
  s.advance(3 * 60_000);
  await s.processor.retryStalled();
  assert.equal(s.credited().length, 1);

  const stuck = setup();
  stuck.rows.set(`${record.hash}:0`, { memo: "7", amount: "50", asset: "XLM", status: "processing", attempts: MAX_ATTEMPTS, updated_at: "2026-11-07T11:00:00.000Z" });
  await stuck.processor.processTransaction(record);
  assert.equal([...stuck.rows.values()][0].status, "needs_review");
});

test("each payment in a transaction is credited; other payments and memos are ignored", async () => {
  const s = setup();
  const both = await s.processor.processTransaction(paymentRecord({ amounts: ["10", "20"] }));
  assert.equal(both.operations.length, 2);
  assert.equal(s.credited().length, 2);
  assert.equal((await s.processor.processTransaction(paymentRecord({ destination: sender.publicKey(), seq: "101" }))).reason, "no_payment");
  assert.equal((await s.processor.processTransaction(paymentRecord({ memo: null, seq: "102" }))).reason, "invalid_memo_type");
  assert.equal((await s.processor.processTransaction(paymentRecord({ memo: "99", seq: "103" }))).reason, "user_not_found");
});

test("a payment inside a fee-bump transaction is credited", async () => {
  const s = setup();
  await s.processor.processTransaction(paymentRecord({ feeBump: true }));
  assert.equal(s.credited().length, 1);
});

test("the daemon moves past each transaction only once it was processed", async () => {
  const s = setup();
  const record = paymentRecord();
  let saved = { cursor: "pt-0" };
  const state = { get: async () => saved, set: async (_k, v) => (saved = v) };
  const failing = { processTransaction: async () => Promise.reject(new Error("db down")), retryStalled: async () => {} };
  await createGatewayDaemon({ processor: failing, chain: { listIncoming: async () => [record] }, state, logger: silent })();
  assert.equal(saved.cursor, "pt-0", "kept for retry");
  await createGatewayDaemon({ processor: s.processor, chain: { listIncoming: async () => [record] }, state, logger: silent })();
  assert.equal(saved.cursor, record.paging_token);
});
