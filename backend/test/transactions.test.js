import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTransactionsService } from "../src/modules/transactions/service.js";
import { createTransactionsRouter } from "../src/modules/transactions/routes.js";
import { serve } from "./helpers/http.js";

const ALICE = "alice-id";
const BOB = "bob-id";

describe("transaction history", () => {
  let http;
  let rows;
  let failing;

  const repository = {
    listByUser: async (userId) => {
      if (failing) throw new Error("secret database detail");
      return rows.filter((r) => r.user_id === userId);
    },
    create: async ({ userId, encryptedPayload }) => {
      const row = { id: `tx-${rows.length}`, user_id: userId, encrypted_payload: encryptedPayload };
      rows.push(row);
      return row;
    },
  };

  before(async () => {
    const service = createTransactionsService({ repository });
    http = await serve(({ requireAuth }) => createTransactionsRouter({ service, requireAuth }));
  });
  after(() => http.close());
  beforeEach(() => {
    failing = false;
    rows = [{ id: "tx-a", user_id: ALICE, encrypted_payload: "alice-payment" }];
  });

  test("a user reads their own history", async () => {
    const res = await http.call("GET", `/api/transactions/${ALICE}`, { as: ALICE });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.transactions.map((t) => t.id), ["tx-a"]);
  });

  test("nobody can read a history without signing in", async () => {
    const res = await http.call("GET", `/api/transactions/${ALICE}`);
    assert.equal(res.status, 401);
    assert.equal(res.body.transactions, undefined);
  });

  test("a signed-in user cannot read someone else's history (IDOR)", async () => {
    const res = await http.call("GET", `/api/transactions/${ALICE}`, { as: BOB });
    assert.equal(res.status, 403);
    assert.equal(res.body.transactions, undefined);
  });

  test("a user records a transaction in their own history", async () => {
    const res = await http.call("POST", "/api/transactions", { as: ALICE, body: { user_id: ALICE, encrypted_payload: "p" } });
    assert.equal(res.status, 201);
    assert.equal(res.body.transaction.user_id, ALICE);
  });

  test("records cannot be written anonymously or into someone else's history", async () => {
    const before = rows.length;
    const anonymous = await http.call("POST", "/api/transactions", { body: { user_id: ALICE, encrypted_payload: "fake" } });
    assert.equal(anonymous.status, 401);
    const forged = await http.call("POST", "/api/transactions", { as: BOB, body: { user_id: ALICE, encrypted_payload: "fake" } });
    assert.equal(forged.status, 403);
    assert.equal(rows.length, before);
  });

  test("rejects missing or oversized records", async () => {
    assert.equal((await http.call("POST", "/api/transactions", { as: ALICE, body: { user_id: ALICE } })).status, 400);
    const big = "x".repeat(16 * 1024 + 1);
    assert.equal((await http.call("POST", "/api/transactions", { as: ALICE, body: { user_id: ALICE, encrypted_payload: big } })).status, 413);
  });

  test("database errors are not shown to the client", async () => {
    failing = true;
    const res = await http.call("GET", `/api/transactions/${ALICE}`, { as: ALICE });
    assert.equal(res.status, 500);
    assert.ok(!JSON.stringify(res.body).includes("secret"));
  });
});
