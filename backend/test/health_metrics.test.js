import { test } from "node:test";
import assert from "node:assert/strict";
import { createHealthService } from "../src/modules/health/service.js";
import { createMetrics } from "../src/http/metrics.js";

const ok = async () => ({});
const failing = async () => {
  throw new Error("password=hunter2 connection refused");
};

test("all checks ok means ok", async () => {
  const report = await createHealthService({ checks: { database: ok, rpc: ok, gateway: async () => ({ status: "off" }) } }).report();
  assert.equal(report.status, "ok");
  assert.equal(report.checks.database.status, "ok");
});

test("a critical failure means down, without leaking the error", async () => {
  const report = await createHealthService({ checks: { database: failing, rpc: ok } }).report();
  assert.equal(report.status, "down");
  assert.equal(report.checks.database.error, "check failed");
  assert.doesNotMatch(JSON.stringify(report), /hunter2/);
});

test("a warning or a non-critical failure means degraded, not down", async () => {
  assert.equal((await createHealthService({ checks: { database: ok, gateway: async () => ({ status: "warn", needsReview: 1 }) } }).report()).status, "degraded");
  assert.equal((await createHealthService({ checks: { database: ok, indexer: failing } }).report()).status, "degraded");
});

test("a hanging check counts as failed", async () => {
  const report = await createHealthService({ checks: { rpc: () => new Promise(() => {}) }, timeoutMs: 20 }).report();
  assert.equal(report.status, "down");
  assert.equal(report.checks.rpc.error, "timed out");
});

test("reports are cached briefly so the endpoint can't be used to flood the network", async () => {
  let calls = 0;
  let clock = 0;
  const service = createHealthService({ checks: { database: async () => (calls++, {}) }, cacheMs: 10_000, now: () => clock });
  await service.report();
  await service.report();
  assert.equal(calls, 1);
  clock = 11_000;
  await service.report();
  assert.equal(calls, 2);
});

test("metrics render as Prometheus text with counts and duration buckets", () => {
  const m = createMetrics({ now: () => 42 });
  m.recordRequest("GET", "/api/notes/:viewingKey", 200, 120);
  m.recordRequest("GET", "/api/notes/:viewingKey", 200, 30);
  m.recordRequest("POST", "unmatched", 404, 1);
  const text = m.render();
  assert.match(text, /starlit_http_requests_total\{method="GET",route="\/api\/notes\/:viewingKey",status="200"\} 2/);
  assert.match(text, /starlit_http_request_duration_seconds_bucket\{method="GET",route="\/api\/notes\/:viewingKey",le="0.05"\} 1/);
  assert.match(text, /starlit_http_request_duration_seconds_count\{method="GET",route="\/api\/notes\/:viewingKey"\} 2/);
  assert.match(text, /route="unmatched",status="404"\} 1/);
  assert.match(text, /starlit_process_uptime_seconds 42/);
});
