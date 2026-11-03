import { test } from "node:test";
import assert from "node:assert/strict";
import { createEventScanner, INDEXER_STATE } from "../src/modules/indexer/scanner.js";

const silent = { info() {}, warn() {}, error() {} };

function setup({ events, oldest = 100, latest = 130, saved = null, failAt = null, chunkSize = 10, pageLimit = 100 }) {
  const state = { value: saved, get: async () => state.value, set: async (name, value) => void (name === INDEXER_STATE && (state.value = value)) };
  const queries = [];
  const rpc = {
    getHealth: async () => ({ oldestLedger: oldest, latestLedger: latest }),
    async getEvents({ startLedger, endLedger, limit }) {
      queries.push(startLedger);
      return { events: events.filter((e) => e.ledger >= startLedger && e.ledger < endLedger).slice(0, limit) };
    },
  };
  const applied = [];
  const applyEvent = async (e) => {
    if (e.ledger === failAt) throw new Error("database down");
    applied.push(e.id);
  };
  const scan = createEventScanner({ rpc, contractId: "CPOOL", state, applyEvent, logger: silent, chunkSize, pageLimit });
  return { scan, state, applied, queries };
}

const ev = (id, ledger) => ({ id, ledger });

test("continues from the saved ledger after a restart", async () => {
  const s = setup({ events: [ev("a", 105), ev("b", 120)], saved: { nextLedger: 110 } });
  await s.scan();
  assert.deepEqual(s.applied, ["b"]);
  assert.deepEqual(s.state.value, { nextLedger: 131 });
});

test("resumes at the oldest ledger RPC still holds instead of failing forever", async () => {
  const s = setup({ events: [ev("a", 100)], saved: { nextLedger: 5 } });
  await s.scan();
  assert.equal(s.queries[0], 100);
  assert.deepEqual(s.applied, ["a"]);
});

test("a failed write stops the scan before that ledger, to retry it next run", async () => {
  const s = setup({ events: [ev("a", 102), ev("b", 115), ev("c", 125)], failAt: 115 });
  await s.scan();
  assert.deepEqual(s.applied, ["a"]);
  assert.deepEqual(s.state.value, { nextLedger: 110 });

  const retry = setup({ events: [ev("a", 102), ev("b", 115), ev("c", 125)], saved: s.state.value });
  await retry.scan();
  assert.deepEqual(retry.applied, ["b", "c"]);
});

test("a full page is followed up instead of dropping the rest of the range", async () => {
  const events = [ev("a", 101), ev("b", 102), ev("c", 103), ev("d", 104)];
  const s = setup({ events, latest: 105, chunkSize: 10, pageLimit: 2 });
  await s.scan();
  assert.deepEqual(s.applied, ["a", "b", "c", "d"]);
});
