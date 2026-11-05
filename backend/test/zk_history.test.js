import { test } from "node:test";
import assert from "node:assert/strict";
import { createZkHistoryRpc, NOT_READY, RETENTION_HANDOFF } from "../src/modules/zk_history/rpc.js";
import { createZkHistoryIngest, ZK_HISTORY_STATE } from "../src/modules/zk_history/ingest.js";

const POOL = "CPOOL";
const OTHER = "COTHER";
const silent = { info() {}, warn() {}, error() {} };
const eventId = (ledger, n) => `${String(ledger * 4096).padStart(19, "0")}-${String(n).padStart(10, "0")}`;
const event = (ledger, n = 1, contractId = POOL) => ({ id: eventId(ledger, n), ledger, contractId, topic: [], value: "AAAA" });

// Same semantics as the Supabase repository.
export function memoryRepository(seed = []) {
  const rows = new Map(seed.map((e) => [e.id, e]));
  const sorted = (ids) => [...rows.values()].filter((e) => ids.includes(e.contractId)).sort((a, b) => a.ledger - b.ledger || (a.id < b.id ? -1 : 1));
  return {
    rows,
    async upsertEvents(list) {
      for (const e of list) if (!rows.has(e.id)) rows.set(e.id, e);
    },
    async pageByLedger(ids, start, cutoff, limit) {
      return sorted(ids).filter((e) => e.ledger >= start && e.ledger < cutoff).slice(0, limit);
    },
    async eventLedger(id) {
      return rows.get(id)?.ledger ?? null;
    },
    async pageAfter(ids, ledger, id, cutoff, limit) {
      return sorted(ids).filter((e) => e.ledger < cutoff && (e.ledger > ledger || (e.ledger === ledger && e.id > id))).slice(0, limit);
    },
  };
}

const filters = (ids = [POOL]) => [{ type: "contract", contractIds: ids, topics: [["**"]] }];

function service({ events = [event(100), event(100, 2), event(150), event(900)], tip = 1000, ready = true } = {}) {
  const handle = createZkHistoryRpc({
    repository: memoryRepository(events),
    contracts: [POOL, OTHER],
    minDeploymentLedger: 100,
    state: async () => ({ tip, oldestLedger: 50, ready }),
    cutoffLedgers: 500,
    upstreamLatestLedger: async () => ({ id: "x", sequence: tip, protocolVersion: 25 }),
  });
  return (method, params) => handle({ jsonrpc: "2.0", id: 7, method, params }, silent);
}

test("pages the archive from the deployment ledger up to the cutoff, then hands off to RPC", async () => {
  const call = service(); // cutoff = 1000 - 500 = 500
  const first = await call("getEvents", { startLedger: 100, filters: filters(), pagination: { limit: 2 } });
  assert.deepEqual(first.result.events.map((e) => e.ledger), [100, 100]);
  assert.equal(first.result.cursor, eventId(100, 2));
  assert.equal(first.result.latestLedger, 1000);

  const second = await call("getEvents", { filters: filters(), pagination: { cursor: first.result.cursor, limit: 2 } });
  assert.deepEqual(second.result.events.map((e) => e.ledger), [150], "the event at 900 is past the cutoff");

  const third = await call("getEvents", { filters: filters(), pagination: { cursor: second.result.cursor } });
  assert.equal(third.error.code, RETENTION_HANDOFF);
  assert.deepEqual(third.error.data, { reason: "retention_threshold", fromLedger: 500 });
});

test("hands off at once when asked for ledgers at or past the cutoff", async () => {
  const res = await service()("getEvents", { startLedger: 500, filters: filters() });
  assert.equal(res.error.code, RETENTION_HANDOFF);
  assert.equal(res.error.data.fromLedger, 500);
});

test("an empty ledger range returns a genesis cursor, which hands off once it runs dry", async () => {
  const call = service({ events: [] });
  const empty = await call("getEvents", { startLedger: 100, filters: filters() });
  assert.deepEqual(empty.result.events, []);
  assert.equal(empty.result.cursor, "bootnode:genesis:100");
  const next = await call("getEvents", { filters: filters(), pagination: { cursor: empty.result.cursor } });
  assert.equal(next.error.code, RETENTION_HANDOFF);
});

test("serves only the requested contracts", async () => {
  const call = service({ events: [event(100), event(120, 1, OTHER)] });
  const res = await call("getEvents", { startLedger: 100, filters: filters([OTHER]) });
  assert.deepEqual(res.result.events.map((e) => e.contractId), [OTHER]);
});

test("refuses what the bootnode refuses", async () => {
  const call = service();
  const code = async (params) => (await call("getEvents", params)).error?.code;
  assert.equal(await code({ startLedger: 100, filters: filters(["CUNKNOWN"]) }), -32602, "another deployment");
  assert.equal(await code({ startLedger: 100, filters: filters([POOL, "CNEW"]) }), NOT_READY, "a newer manifest");
  assert.equal(await code({ startLedger: 100, filters: [{ type: "contract", contractIds: [POOL], topics: [["x"]] }] }), -32602, "topic filters");
  assert.equal(await code({ startLedger: 100, endLedger: 200, filters: filters() }), -32602);
  assert.equal(await code({ startLedger: 100, xdrFormat: "json", filters: filters() }), -32602);
  assert.equal(await code({ startLedger: 100, filters: filters(), pagination: { cursor: eventId(100, 1) } }), -32602, "both start and cursor");
  assert.equal(await code({ filters: filters(), pagination: { cursor: "nonsense" } }), -32602);
  assert.equal(await code({ filters: filters(), pagination: { cursor: eventId(333, 1) } }), -32602, "unknown cursor");
  assert.equal((await call("sendTransaction", {})).error.code, -32601, "only getEvents and getLatestLedger");
});

test("says it is warming up until the archive has caught up once", async () => {
  const res = await service({ ready: false })("getEvents", { startLedger: 100, filters: filters() });
  assert.equal(res.error.code, NOT_READY);
});

test("getLatestLedger passes through to Stellar RPC", async () => {
  assert.equal((await service()("getLatestLedger")).result.sequence, 1000);
});

test("ingest copies events window by window, then marks the archive ready at the tip", async () => {
  const chain = [event(100), event(2500), event(4100)];
  const calls = [];
  const rpcCall = async (method, params) => {
    calls.push(params);
    if (method === "getLatestLedger") return { sequence: 4200 };
    const events = chain.filter((e) => e.ledger >= params.startLedger && e.ledger < params.endLedger);
    return { events, oldestLedger: 90, latestLedger: 4200, cursor: "" };
  };
  const repository = memoryRepository();
  const saved = new Map();
  const state = { get: async (k) => saved.get(k) ?? null, set: async (k, v) => saved.set(k, v) };
  await createZkHistoryIngest({ rpcCall, repository, state, contracts: [POOL], startLedger: 100, logger: silent })();

  assert.deepEqual([...repository.rows.values()].map((e) => e.ledger), [100, 2500, 4100]);
  assert.deepEqual(saved.get(ZK_HISTORY_STATE), { nextLedger: 4201, oldestLedger: 90, tip: 4200, ready: true });
  assert.deepEqual(calls[1].filters, filters());
  assert.ok(calls.slice(1).every((p) => p.endLedger - p.startLedger <= 2000), "bounded windows");
});

test("ingest keeps its position when RPC or the database fails, so nothing is skipped", async () => {
  let failing = true;
  const rpcCall = async (method, params) => {
    if (method === "getLatestLedger") return { sequence: 300 };
    if (failing && params.startLedger === 100) throw new Error("getEvents: startLedger must be within the ledger range: 200 - 300");
    return { events: [event(150)], oldestLedger: 90 };
  };
  const repository = memoryRepository();
  const saved = new Map();
  const state = { get: async (k) => saved.get(k) ?? null, set: async (k, v) => saved.set(k, v) };
  const ingest = createZkHistoryIngest({ rpcCall, repository, state, contracts: [POOL], startLedger: 100, logger: silent });
  await ingest();
  assert.equal(saved.get(ZK_HISTORY_STATE), undefined, "no position saved past the gap");
  failing = false;
  await ingest();
  assert.equal(saved.get(ZK_HISTORY_STATE).ready, true);
  assert.equal(repository.rows.size, 1);
});
