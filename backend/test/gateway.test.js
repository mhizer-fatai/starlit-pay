import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as StellarSdk from "@stellar/stellar-sdk";
import { createDepositProcessor, MAX_ATTEMPTS } from "../src/modules/gateway/service.js";
import { createGatewayDaemon } from "../src/modules/gateway/daemon.js";

const PASSPHRASE = StellarSdk.Networks.TESTNET;
const gateway = StellarSdk.Keypair.random();
const sender = StellarSdk.Keypair.random();
const silent = { info() {}, warn() {}, error() {} };

function paymentRecord({ amounts = ["50"], memo = "7", memoType = "id", destination = gateway.publicKey(), seq = "100" } = {}) {
  const builder = new StellarSdk.TransactionBuilder(new StellarSdk.Account(sender.publicKey(), seq), { fee: "100", networkPassphrase: PASSPHRASE });
  for (const amount of amounts) builder.addOperation(StellarSdk.Operation.payment({ destination, asset: StellarSdk.Asset.native(), amount }));
  if (memo !== null) builder.addMemo(memoType === "id" ? StellarSdk.Memo.id(memo) : StellarSdk.Memo.text(memo));
  const tx = builder.setTimeout(0).build();
  tx.sign(sender);
  return { hash: tx.hash().toString("hex"), envelope_xdr: tx.toXDR(), memo, memo_type: memo === null ? "none" : memoType, paging_token: `pt-${seq}` };
}

function setup({ outcomes = [], blocked = false } = {}) {
  let clock = Date.parse("2026-11-03T12:00:00Z");
  const rows = new Map();
  const notes = new Map();
  const users = new Map([[7, { id: "u1", username: "alice", public_encryption_key: "key-1" }]]);
  const deposits = [];
  const statuses = new Map();
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
      [...rows].filter(([, r]) => ["processing", "submitted", "failed"].includes(r.status) && r.updated_at < staleBefore && r.attempts <= max).map(([k]) => k.split(":")[0]),
    noteExists: async (commitment) => notes.has(commitment),
    async insertNote(note) {
      if (notes.has(note.commitment)) throw new Error("duplicate note");
      notes.set(note.commitment, note);
    },
    deleteNote: async (commitment) => void notes.delete(commitment),
  };

  const records = new Map();
  const chain = {
    txTimeoutSeconds: 180,
    fetchTransaction: async (hash) => records.get(hash),
    transactionStatus: async (hash) => statuses.get(hash) ?? "NOT_FOUND",
    async prepareDeposit(args) {
      const hash = `pool-${deposits.length + 1}`;
      return {
        hash,
        submit: async () => {
          const outcome = outcomes.shift() ?? "SUCCESS";
          deposits.push({ ...args, hash, outcome });
          if (outcome === "SUCCESS") statuses.set(hash, "SUCCESS");
          return outcome;
        },
      };
    },
  };

  const processor = createDepositProcessor({
    repository,
    chain,
    isAddressBlocked: async () => blocked,
    calculateCommitment: async (amount, key, token, secret) => crypto.createHash("sha256").update(`${amount}:${key}:${token}:${secret}`).digest("hex"),
    encryptNoteForUser: () => ({ ephemeralPublicKey: "aa", nonce: "bb", ciphertext: "cc" }),
    gatewayAddress: gateway.publicKey(),
    gatewaySecret: gateway.secret(),
    poolContract: "CPOOL",
    networkPassphrase: PASSPHRASE,
    logger: silent,
    now: () => clock,
  });

  const landed = () => deposits.filter((d) => d.outcome === "SUCCESS" || statuses.get(d.hash) === "SUCCESS");
  return { processor, rows, notes, users, deposits, landed, statuses, records, advance: (ms) => (clock += ms) };
}

test("a payment is credited once, however often it is seen", async () => {
  const s = setup();
  const record = paymentRecord();
  assert.equal((await s.processor.processTransaction(record)).processed, true);
  assert.equal((await s.processor.processTransaction(record)).operations[0].reason, "already_processed");
  assert.equal(s.landed().length, 1);
});

test("a user changing keys can't get an old payment credited again (the replay bug)", async () => {
  const s = setup();
  const record = paymentRecord();
  await s.processor.processTransaction(record);
  s.users.get(7).public_encryption_key = "key-2"; // passkey upgrade: new keys, so a new commitment
  await s.processor.processTransaction(record);
  assert.equal(s.landed().length, 1);
});

test("payments credited before this ledger existed are recognised by their note", async () => {
  const s = setup();
  const record = paymentRecord();
  await s.processor.processTransaction(record);
  s.rows.clear(); // as if the payment predates gateway_deposits
  const result = await s.processor.processTransaction(record);
  assert.equal(result.operations[0].reason, "already_processed");
  assert.equal(s.landed().length, 1);
});

test("two simultaneous attempts (daemon and endpoint) credit once", async () => {
  const s = setup();
  const record = paymentRecord();
  await Promise.all([s.processor.processTransaction(record), s.processor.processTransaction(record)]);
  assert.equal(s.landed().length, 1);
});

test("a failed deposit removes its note and is retried until it lands", async () => {
  const s = setup({ outcomes: ["FAILED"] });
  const record = paymentRecord();
  await assert.rejects(s.processor.processTransaction(record));
  const [row] = s.rows.values();
  assert.equal(row.status, "failed");
  assert.equal(s.notes.size, 0);

  assert.equal((await s.processor.processTransaction(record)).processed, true);
  assert.equal(s.landed().length, 1);
  assert.equal(s.notes.size, 1);
});

test("a payment that keeps failing is set aside for review", async () => {
  const s = setup({ outcomes: Array(MAX_ATTEMPTS).fill("FAILED") });
  const record = paymentRecord();
  for (let i = 0; i < MAX_ATTEMPTS; i++) await assert.rejects(s.processor.processTransaction(record));
  assert.equal((await s.processor.processTransaction(record)).operations[0].reason, "needs_review");
  assert.equal(s.deposits.length, MAX_ATTEMPTS);
});

test("an unknown outcome is not retried while the deposit could still land", async () => {
  const s = setup({ outcomes: ["UNKNOWN"] });
  const record = paymentRecord();
  s.records.set(record.hash, record);
  assert.equal((await s.processor.processTransaction(record)).operations[0].reason, "pending");
  assert.equal((await s.processor.processTransaction(record)).operations[0].reason, "in_progress");
  await s.processor.retryStalled();
  assert.equal(s.deposits.length, 1);
});

test("an unknown outcome that did land is marked done, not deposited again", async () => {
  const s = setup({ outcomes: ["UNKNOWN"] });
  const record = paymentRecord();
  s.records.set(record.hash, record);
  await s.processor.processTransaction(record);
  s.statuses.set("pool-1", "SUCCESS"); // it landed after all
  s.advance(10 * 60_000);
  await s.processor.retryStalled();
  assert.equal(s.deposits.length, 1);
  assert.equal([...s.rows.values()][0].status, "done");
});

test("an unknown outcome that never landed is retried once it has expired", async () => {
  const s = setup({ outcomes: ["UNKNOWN", "SUCCESS"] });
  const record = paymentRecord();
  s.records.set(record.hash, record);
  await s.processor.processTransaction(record);
  s.advance(10 * 60_000);
  await s.processor.retryStalled();
  assert.equal(s.landed().length, 1);
  assert.equal(s.notes.size, 1);
  assert.equal([...s.rows.values()][0].status, "done");
});

test("each payment in a transaction is credited, other payments ignored", async () => {
  const s = setup();
  await s.processor.processTransaction(paymentRecord({ amounts: ["10", "20"] }));
  assert.deepEqual(s.landed().map((d) => d.amount), [10, 20]);

  for (const record of [
    paymentRecord({ memo: null, seq: "1" }),
    paymentRecord({ memo: "hello", memoType: "text", seq: "2" }),
    paymentRecord({ memo: "99", seq: "3" }),
    paymentRecord({ destination: sender.publicKey(), seq: "4" }),
  ]) {
    assert.equal((await s.processor.processTransaction(record)).processed, false);
  }
  assert.equal(s.landed().length, 2);
});

test("a payment inside a fee-bump transaction is credited", async () => {
  const s = setup();
  const inner = paymentRecord();
  const sponsor = StellarSdk.Keypair.random();
  const bump = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(sponsor, "200", StellarSdk.TransactionBuilder.fromXDR(inner.envelope_xdr, PASSPHRASE), PASSPHRASE);
  bump.sign(sponsor);
  const result = await s.processor.processTransaction({ ...inner, hash: bump.hash().toString("hex"), envelope_xdr: bump.toXDR() });
  assert.equal(result.processed, true);
  assert.equal(s.landed().length, 1);
});

test("a blocked sender is set aside, not credited", async () => {
  const s = setup({ blocked: true });
  const result = await s.processor.processTransaction(paymentRecord());
  assert.equal(result.reason ?? result.operations[0].reason, "sanctioned_address");
  assert.equal(s.deposits.length, 0);
  assert.equal([...s.rows.values()][0].status, "needs_review");
});

function daemonSetup(processTransaction, cursor = "pt-0") {
  const saved = { gateway: cursor ? { cursor } : null };
  const state = { get: async (name) => saved[name], set: async (name, value) => void (saved[name] = value) };
  const chain = { listIncoming: async () => [{ hash: "a", paging_token: "pt-1" }, { hash: "b", paging_token: "pt-2" }, { hash: "c", paging_token: "pt-3" }] };
  const tick = createGatewayDaemon({ processor: { processTransaction, retryStalled: async () => {} }, chain, state, logger: silent });
  return { tick, saved };
}

test("the daemon saves its position after each transaction", async () => {
  const { tick, saved } = daemonSetup(async () => ({}));
  await tick();
  assert.equal(saved.gateway.cursor, "pt-3");
});

test("the daemon does not move past a transaction it could not process", async () => {
  const { tick, saved } = daemonSetup(async (record) => {
    if (record.hash === "b") throw new Error("database down");
  });
  await tick();
  assert.equal(saved.gateway.cursor, "pt-1");
});

test("without a saved position the daemon waits instead of replaying history", async () => {
  let calls = 0;
  const { tick, saved } = daemonSetup(async () => calls++, null);
  await tick();
  assert.equal(calls, 0);
  assert.equal(saved.gateway, null);
});
