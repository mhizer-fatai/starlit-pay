import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createPaymentApproval } from "../src/payment_approval.js";

function fakeSessions({ result, fresh }) {
  return { authenticate: () => result, isFresh: () => fresh };
}

function run(middleware, headers = {}) {
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
  middleware(req, res, () => {
    out.nextCalled = true;
  });
  return { ...out, user: req.user };
}

describe("payment approval for relayer spends", () => {
  test("allows a session that confirmed with passkey or PIN in the last few minutes", () => {
    const mw = createPaymentApproval({ sessions: fakeSessions({ result: { session: { id: "u1" } }, fresh: true }) });
    const out = run(mw);
    assert.equal(out.nextCalled, true);
    assert.equal(out.user.id, "u1");
  });

  test("refuses a signed-in session that has not confirmed recently", () => {
    const mw = createPaymentApproval({ sessions: fakeSessions({ result: { session: { id: "u1" } }, fresh: false }) });
    const out = run(mw);
    assert.equal(out.nextCalled, false);
    assert.equal(out.status, 401);
    assert.equal(out.body.code, "reauth_required");
  });

  test("refuses anonymous, expired and cross-site (CSRF) requests", () => {
    for (const [result, status, code] of [
      [null, 401, "no_session"],
      [{ error: "invalid" }, 401, "invalid_session"],
      [{ error: "csrf" }, 403, "csrf"],
    ]) {
      const mw = createPaymentApproval({ sessions: fakeSessions({ result, fresh: true }) });
      const out = run(mw);
      assert.equal(out.nextCalled, false);
      assert.equal(out.status, status);
      assert.equal(out.body.code, code);
    }
  });
});
