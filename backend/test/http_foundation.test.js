import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { z } from "zod";
import { errorMiddleware, HttpError, notFound } from "../src/http/errors.js";
import { formatLogLine } from "../src/http/logger.js";
import { currentRequestId, requestContext } from "../src/http/requestContext.js";
import { validateBody } from "../src/http/validate.js";

let server;
let base;

before(async () => {
  const app = express();
  app.use(requestContext);
  app.use(express.json({ limit: "1kb" }));
  app.get("/id", (req, res) => res.json({ id: currentRequestId() }));
  app.post("/items", validateBody(z.object({ name: z.string() })), (req, res) => res.json(req.body));
  app.get("/teapot", () => {
    throw new HttpError(418, "Short and stout.", "teapot");
  });
  app.get("/boom", () => {
    throw new Error("password=hunter2 at db.internal");
  });
  app.use(notFound);
  app.use(errorMiddleware);
  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const post = (path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body });

test("every response carries a request id, available anywhere in the request", async () => {
  const res = await fetch(`${base}/id`);
  const id = res.headers.get("x-request-id");
  assert.match(id, /^[\w-]{8,64}$/);
  assert.equal((await res.json()).id, id);
});

test("a well-formed incoming request id is kept, a hostile one replaced", async () => {
  const kept = await fetch(`${base}/id`, { headers: { "x-request-id": "trace-12345678" } });
  assert.equal(kept.headers.get("x-request-id"), "trace-12345678");

  const replaced = await fetch(`${base}/id`, { headers: { "x-request-id": "bad id\twith junk" } });
  assert.notEqual(replaced.headers.get("x-request-id"), "bad id\twith junk");
});

test("unknown routes answer JSON 404", async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "Not found.", code: "not_found" });
});

test("HttpError keeps its status, message and code", async () => {
  const res = await fetch(`${base}/teapot`);
  assert.equal(res.status, 418);
  assert.deepEqual(await res.json(), { error: "Short and stout.", code: "teapot" });
});

test("unexpected errors never reach the client, but give it an id to report", async () => {
  const res = await fetch(`${base}/boom`);
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.error, "Something went wrong. Please try again.");
  assert.equal(body.requestId, res.headers.get("x-request-id"));
  assert.doesNotMatch(JSON.stringify(body), /hunter2/);
});

test("malformed JSON is a 400 and an oversized body a 413, not a 500", async () => {
  assert.equal((await post("/items", "{not json")).status, 400);
  assert.equal((await post("/items", JSON.stringify({ name: "x".repeat(2048) }))).status, 413);
});

test("validation rejects bad input and drops unknown fields", async () => {
  const bad = await post("/items", JSON.stringify({ name: 1 }));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, "validation_error");

  const good = await post("/items", JSON.stringify({ name: "a", isAdmin: true }));
  assert.deepEqual(await good.json(), { name: "a" });
});

const log = (args, asJson = true) => formatLogLine("info", args, { requestId: "req-1", time: "t", asJson });

test("log lines are JSON with the request id and trailing fields", () => {
  assert.deepEqual(JSON.parse(log(["paid", { amount: 5 }])), { amount: 5, level: "info", time: "t", requestId: "req-1", message: "paid" });
});

test("console-style arguments still work", () => {
  assert.equal(JSON.parse(log(["balance", 12, "XLM"])).message, "balance 12 XLM");
});

test("errors keep their message and stack", () => {
  const entry = JSON.parse(log(["failed:", new Error("rpc down")]));
  assert.equal(entry.message, "failed: rpc down");
  assert.match(entry.stack, /rpc down/);
});

test("a log line survives values JSON can't serialize", () => {
  const circular = {};
  circular.self = circular;
  assert.equal(JSON.parse(log(["fee", { stroops: 10n }])).stroops, "10");
  assert.doesNotThrow(() => log(["state", circular]));
  assert.doesNotThrow(() => log([{ a: 1n }]));
});

test("a caller's fields can't overwrite the log's own keys", () => {
  assert.equal(JSON.parse(log(["real", { message: "forged", level: "error" }])).message, "real");
  assert.equal(JSON.parse(log(["real", { level: "error" }])).level, "info");
});

test("a terminal gets readable text", () => {
  assert.match(log(["hello", { a: 1 }], false), /^t INFO \[req-1\] hello \{"a":1\}$/);
});
