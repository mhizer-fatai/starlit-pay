import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createPaymentApproval } from "../src/payment_approval.js";

function fakeSessions({ result, fresh, active = true }) {
  return { authenticate: () => result, isFresh: () => fresh, isActive: async () => active };
}

async function run(middleware, headers = {}) {
  const req = { headers, method: "POST" };
  const out = { status: 200, body: null, nextCalled: false };
  const res = {
    status(code) {
      out.status = code;
      return this;
    },
    json(body) {
      out.body = body;
      return this;
    },
  };
  await middleware(req, res, () => {
    out.nextCalled = true;
  });
  return { ...out, user: req.user };
}

describe("payment approval for relayer spends", () => {
  test("allows a session that confirmed with passkey or PIN in the last few minutes", async () => {
    const mw = createPaymentApproval({ sessions: fakeSessions({ result: { session: { id: "u1" } }, fresh: true }) });
    const out = await run(mw);
    assert.equal(out.nextCalled, true);
    assert.equal(out.user.id, "u1");
  });

  test("refuses a session that was signed out, even while its access token is still valid", async () => {
    const mw = createPaymentApproval({ sessions: fakeSessions({ result: { session: { id: "u1" } }, fresh: true, active: false }) });
    const out = await run(mw);
    assert.equal(out.nextCalled, false);
    assert.equal(out.status, 401);
    assert.equal(out.body.code, "invalid_session");
  });

  test("refuses a signed-in session that has not confirmed recently", async () => {
    const mw = createPaymentApproval({ sessions: fakeSessions({ result: { session: { id: "u1" } }, fresh: false }) });
    const out = await run(mw);
    assert.equal(out.nextCalled, false);
    assert.equal(out.status, 401);
    assert.equal(out.body.code, "reauth_required");
  });

  test("refuses anonymous, expired and cross-site (CSRF) requests", async () => {
    for (const [result, status, code] of [
      [null, 401, "no_session"],
      [{ error: "invalid" }, 401, "invalid_session"],
      [{ error: "csrf" }, 403, "csrf"],
    ]) {
      const mw = createPaymentApproval({ sessions: fakeSessions({ result, fresh: true }) });
      const out = await run(mw);
      assert.equal(out.nextCalled, false);
      assert.equal(out.status, status);
      assert.equal(out.body.code, code);
    }
  });
});
