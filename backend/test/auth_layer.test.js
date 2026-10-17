import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startHarness, TEST_ENV } from "./helpers/harness.js";
import { createSoftAuthenticator } from "./helpers/soft_authenticator.js";

const EMAIL_PROOF = { "x-supabase-auth": "google-token-alice" };
const b64u32 = () => crypto.randomBytes(32).toString("base64url");
const fakeWrap = () => crypto.randomBytes(60).toString("base64url");
const MIN = 60 * 1000;

let h;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(async () => {
  await h.close();
});

/** Enrols a passkey for Alice through the email-proof path and returns the signed-in client. */
async function enrolFirstPasskey(client = h.client(), authenticator = createSoftAuthenticator()) {
  const opts = await client.post("/api/auth/passkey/register/options", {}, { headers: EMAIL_PROOF });
  assert.equal(opts.status, 200, JSON.stringify(opts.body));
  const verify = await client.post("/api/auth/passkey/register/verify", {
    challengeId: opts.body.challengeId,
    response: authenticator.register(opts.body.options),
    deviceName: "Test phone",
    prfEnabled: true,
  });
  assert.equal(verify.status, 201, JSON.stringify(verify.body));
  return { client, authenticator, passkey: verify.body.passkey };
}

async function passkeyLogin(client, authenticator, assertOpts) {
  const opts = await client.post("/api/auth/passkey/login/options", { purpose: "login" });
  return client.post("/api/auth/passkey/login/verify", {
    challengeId: opts.body.challengeId,
    response: authenticator.assert(opts.body.options, assertOpts),
  });
}

async function stepUp(client, authenticator) {
  const opts = await client.post("/api/auth/passkey/login/options", { purpose: "stepup" });
  assert.equal(opts.status, 200, JSON.stringify(opts.body));
  const res = await client.post("/api/auth/passkey/login/verify", {
    challengeId: opts.body.challengeId,
    response: authenticator.assert(opts.body.options),
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

describe("configuration", () => {
  test("fails closed with 503 when secrets are missing", async () => {
    const weak = await startHarness({ env: { ...TEST_ENV, PIN_PEPPER_KEY: "short" } });
    try {
      const res = await weak.client().post("/api/auth/passkey/login/options", {});
      assert.equal(res.status, 503);
      assert.equal(res.body.code, "auth_not_configured");
    } finally {
      await weak.close();
    }
  });
});

describe("passkey registration", () => {
  test("first passkey requires proof of email", async () => {
    const res = await h.client().post("/api/auth/passkey/register/options", {});
    assert.equal(res.status, 401);
    const forged = await h.client().post("/api/auth/passkey/register/options", {}, { headers: { "x-supabase-auth": "made-up" } });
    assert.equal(forged.status, 401);
  });

  test("enrolling the first passkey signs the user in", async () => {
    const { client, passkey } = await enrolFirstPasskey();
    assert.equal(passkey.deviceName, "Test phone");
    assert.equal(passkey.prfEnabled, true);
    const session = await client.get("/api/auth/session");
    assert.equal(session.status, 200);
    assert.equal(session.body.user.id, h.alice.id);
    assert.deepEqual(session.body.amr, ["passkey"]);
    assert.equal(session.body.user.identity_commitment, undefined, "login commitment must never be returned");
  });

  test("a registration challenge cannot be used twice", async () => {
    const client = h.client();
    const authenticator = createSoftAuthenticator();
    const opts = await client.post("/api/auth/passkey/register/options", {}, { headers: EMAIL_PROOF });
    const body = { challengeId: opts.body.challengeId, response: authenticator.register(opts.body.options) };
    assert.equal((await client.post("/api/auth/passkey/register/verify", body)).status, 201);
    const replay = await client.post("/api/auth/passkey/register/verify", body);
    assert.equal(replay.status, 400);
    assert.equal(replay.body.code, "challenge_invalid");
  });

  test("rejects a response from the wrong origin", async () => {
    const client = h.client();
    const opts = await client.post("/api/auth/passkey/register/options", {}, { headers: EMAIL_PROOF });
    const res = await client.post("/api/auth/passkey/register/verify", {
      challengeId: opts.body.challengeId,
      response: createSoftAuthenticator().register(opts.body.options, { originOverride: "https://evil.example" }),
    });
    assert.equal(res.status, 400);
    assert.equal(h.store.db.passkeys.size, 0);
  });

  test("rejects an expired challenge", async () => {
    const client = h.client();
    const opts = await client.post("/api/auth/passkey/register/options", {}, { headers: EMAIL_PROOF });
    h.advance(6 * MIN);
    const res = await client.post("/api/auth/passkey/register/verify", {
      challengeId: opts.body.challengeId,
      response: createSoftAuthenticator().register(opts.body.options),
    });
    assert.equal(res.status, 400);
  });

  test("adding a second passkey needs a fresh ceremony, not just email proof", async () => {
    const { client, authenticator } = await enrolFirstPasskey();

    const viaEmail = await h.client().post("/api/auth/passkey/register/options", {}, { headers: EMAIL_PROOF });
    assert.equal(viaEmail.status, 401);
    assert.equal(viaEmail.body.code, "reauth_required");

    h.advance(6 * MIN);
    await client.post("/api/auth/refresh");
    const stale = await client.post("/api/auth/passkey/register/options", {});
    assert.equal(stale.body.code, "reauth_required");

    await stepUp(client, authenticator);
    const fresh = await client.post("/api/auth/passkey/register/options", {});
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.options.excludeCredentials.length, 1);
  });
});

describe("passkey login", () => {
  test("releases the vault and only this passkey's wrapped key", async () => {
    const { client, authenticator, passkey } = await enrolFirstPasskey();
    const wrap = fakeWrap();
    const created = await client.post("/api/vault", {
      encryptedSeed: fakeWrap(),
      passkeyWrap: { passkeyId: passkey.id, wrappedDek: wrap },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const fresh = h.client();
    const res = await passkeyLogin(fresh, authenticator);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.user.id, h.alice.id);
    assert.equal(res.body.wrappedDek, wrap);
    assert.ok(res.body.vault.encryptedSeed);
    assert.equal((await fresh.get("/api/auth/session")).status, 200);
  });

  test("rejects a replayed assertion", async () => {
    const { authenticator } = await enrolFirstPasskey();
    const client = h.client();
    const opts = await client.post("/api/auth/passkey/login/options", {});
    const body = { challengeId: opts.body.challengeId, response: authenticator.assert(opts.body.options) };
    assert.equal((await client.post("/api/auth/passkey/login/verify", body)).status, 200);
    assert.equal((await h.client().post("/api/auth/passkey/login/verify", body)).status, 400);
  });

  test("rejects a cloned authenticator whose counter goes backwards", async () => {
    const { authenticator } = await enrolFirstPasskey();
    assert.equal((await passkeyLogin(h.client(), authenticator)).status, 200);
    assert.equal((await passkeyLogin(h.client(), authenticator)).status, 200);
    const cloned = await passkeyLogin(h.client(), authenticator, { counterOverride: 1 });
    assert.equal(cloned.status, 401);
  });

  test("rejects an unknown passkey and a forged signature", async () => {
    await enrolFirstPasskey();
    const stranger = await passkeyLogin(h.client(), createSoftAuthenticator());
    assert.equal(stranger.status, 401);
  });

  test("a passkey in its recovery waiting period cannot sign in", async () => {
    const { authenticator, passkey } = await enrolFirstPasskey();
    h.store.db.passkeys.get(passkey.id).pending_until = new Date(h.clock.t + 24 * 60 * MIN).toISOString();
    const res = await passkeyLogin(h.client(), authenticator);
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "passkey_pending");
  });
});

describe("sessions", () => {
  test("cookie-authenticated writes require the CSRF header", async () => {
    const { client } = await enrolFirstPasskey();
    const res = await client.req("POST", "/api/vault", { body: { encryptedSeed: fakeWrap() }, csrf: false });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "csrf");
  });

  test("access tokens expire and refresh rotates", async () => {
    const { client } = await enrolFirstPasskey();
    h.advance(16 * MIN);
    assert.equal((await client.get("/api/auth/session")).status, 401);
    assert.equal((await client.post("/api/auth/refresh")).status, 200);
    const session = await client.get("/api/auth/session");
    assert.equal(session.status, 200);
    assert.equal(session.body.fresh, false, "refresh must not count as a fresh sign-in");
  });

  test("reusing a refresh token revokes the whole session family", async () => {
    const { client } = await enrolFirstPasskey();
    const stolenRefresh = client.jar.get("starlit_rt");
    assert.equal((await client.post("/api/auth/refresh")).status, 200);

    const attacker = h.client();
    attacker.jar.set("starlit_rt", stolenRefresh);
    assert.equal((await attacker.post("/api/auth/refresh")).status, 401);

    // The legitimate client's newer refresh token is revoked too.
    assert.equal((await client.post("/api/auth/refresh")).status, 401);
  });

  test("logout revokes the refresh token", async () => {
    const { client } = await enrolFirstPasskey();
    const refresh = client.jar.get("starlit_rt");
    assert.equal((await client.post("/api/auth/logout")).status, 200);
    const replay = h.client();
    replay.jar.set("starlit_rt", refresh);
    assert.equal((await replay.post("/api/auth/refresh")).status, 401);
  });
});

describe("vault and PIN", () => {
  async function setUpVaultWithPin() {
    const enrolled = await enrolFirstPasskey();
    const { client, passkey } = enrolled;
    assert.equal((await client.post("/api/vault", { encryptedSeed: fakeWrap(), passkeyWrap: { passkeyId: passkey.id, wrappedDek: fakeWrap() } })).status, 201);
    const begin = await client.post("/api/vault/pin/setup/begin", {});
    assert.equal(begin.status, 200, JSON.stringify(begin.body));
    assert.equal(begin.body.params.algorithm, "argon2id");
    const pinVerifier = b64u32();
    const pinWrap = fakeWrap();
    const complete = await client.post("/api/vault/pin/setup/complete", { ticket: begin.body.ticket, pinVerifier, wrappedDek: pinWrap });
    assert.equal(complete.status, 200, JSON.stringify(complete.body));
    return { ...enrolled, pinVerifier, pinWrap, serverShare: begin.body.serverShare, salt: begin.body.salt };
  }

  test("a vault can only be created once", async () => {
    const { client } = await enrolFirstPasskey();
    assert.equal((await client.post("/api/vault", { encryptedSeed: fakeWrap() })).status, 201);
    const again = await client.post("/api/vault", { encryptedSeed: fakeWrap() });
    assert.equal(again.status, 409);
  });

  test("vault creation needs a fresh sign-in", async () => {
    const { client } = await enrolFirstPasskey();
    h.advance(6 * MIN);
    await client.post("/api/auth/refresh");
    const res = await client.post("/api/vault", { encryptedSeed: fakeWrap() });
    assert.equal(res.body.code, "reauth_required");
  });

  test("correct PIN releases the server share, wrap and a session", async () => {
    const { pinVerifier, pinWrap, serverShare, salt } = await setUpVaultWithPin();
    const device = h.client();

    assert.equal((await device.post("/api/vault/pin/salt", {})).status, 401, "salt needs email proof");
    const saltRes = await device.post("/api/vault/pin/salt", {}, { headers: EMAIL_PROOF });
    assert.equal(saltRes.body.salt, salt);

    const res = await device.post("/api/vault/pin/unlock", { pinVerifier }, { headers: EMAIL_PROOF });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.serverShare, serverShare);
    assert.equal(res.body.wrappedDek, pinWrap);
    assert.deepEqual((await device.get("/api/auth/session")).body.amr, ["pin"]);
  });

  test("PIN unlock requires email proof", async () => {
    const { pinVerifier } = await setUpVaultWithPin();
    const res = await h.client().post("/api/vault/pin/unlock", { pinVerifier });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "email_proof_required");
  });

  test("five wrong PINs lock the account, with backoff", async () => {
    const { pinVerifier } = await setUpVaultWithPin();
    const device = h.client();
    const wrong = () => device.post("/api/vault/pin/unlock", { pinVerifier: b64u32() }, { headers: EMAIL_PROOF });

    for (let i = 1; i <= 4; i++) {
      const res = await wrong();
      assert.equal(res.status, 401);
      assert.equal(res.body.attemptsRemaining, 5 - i);
    }
    const fifth = await wrong();
    assert.equal(fifth.status, 429);
    assert.equal(fifth.body.retryAfterSec, 15 * 60);

    const rightButLocked = await device.post("/api/vault/pin/unlock", { pinVerifier }, { headers: EMAIL_PROOF });
    assert.equal(rightButLocked.status, 429, "even the correct PIN is refused while locked");

    h.advance(16 * MIN);
    for (let i = 0; i < 5; i++) await wrong();
    const second = await device.post("/api/vault/pin/unlock", { pinVerifier }, { headers: EMAIL_PROOF });
    assert.equal(second.status, 429);
    assert.equal(second.body.retryAfterSec, 30 * 60, "second lockout doubles");

    h.advance(31 * MIN);
    const ok = await device.post("/api/vault/pin/unlock", { pinVerifier }, { headers: EMAIL_PROOF });
    assert.equal(ok.status, 200);
  });

  test("parallel guesses cannot exceed the attempt limit or stack the backoff", async () => {
    await setUpVaultWithPin();
    let compared = 0;
    const reserve = h.store.reservePinAttempt;
    h.store.reservePinAttempt = async (...args) => {
      const r = await reserve(...args);
      if (r.allowed) compared += 1;
      return r;
    };

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        h.client().post("/api/vault/pin/unlock", { pinVerifier: b64u32() }, { headers: EMAIL_PROOF })
      )
    );
    assert.equal(compared, 5, "only five guesses are ever checked");
    assert.equal(results.filter((r) => r.status === 200).length, 0);
    assert.equal(results.filter((r) => r.status === 401 || r.status === 429).length, 20);
    assert.equal(h.store.db.pinGuards.get(h.alice.id).lock_count, 1, "one lockout, not one per parallel failure");
  });

  test("PIN setup tickets cannot be tampered with", async () => {
    const { client } = await setUpVaultWithPin();
    const begin = await client.post("/api/vault/pin/setup/begin", {});
    const tampered = begin.body.ticket.slice(0, -2) + (begin.body.ticket.endsWith("A") ? "BB" : "AA");
    const res = await client.post("/api/vault/pin/setup/complete", { ticket: tampered, pinVerifier: b64u32(), wrappedDek: fakeWrap() });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "ticket_invalid");
  });

  test("stored PIN data is not the verifier itself", async () => {
    const { pinVerifier } = await setUpVaultWithPin();
    const guard = h.store.db.pinGuards.get(h.alice.id);
    assert.notEqual(guard.verifier_mac, pinVerifier);
    assert.ok(!JSON.stringify(guard).includes(pinVerifier));
  });
});

describe("passkey management", () => {
  test("cannot remove the last passkey when no PIN is set", async () => {
    const { client, passkey } = await enrolFirstPasskey();
    const res = await client.req("DELETE", `/api/auth/passkeys/${passkey.id}`);
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "last_unlock_method");
  });

  test("removing a passkey revokes its sessions and sign-in", async () => {
    const { client, authenticator, passkey } = await enrolFirstPasskey();
    await client.post("/api/vault", { encryptedSeed: fakeWrap() });
    const begin = await client.post("/api/vault/pin/setup/begin", {});
    await client.post("/api/vault/pin/setup/complete", { ticket: begin.body.ticket, pinVerifier: b64u32(), wrappedDek: fakeWrap() });

    const otherDevice = h.client();
    assert.equal((await passkeyLogin(otherDevice, authenticator)).status, 200);

    const del = await client.req("DELETE", `/api/auth/passkeys/${passkey.id}`);
    assert.equal(del.status, 200, JSON.stringify(del.body));

    assert.equal((await otherDevice.post("/api/auth/refresh")).status, 401, "sessions from that passkey are revoked");
    assert.equal((await passkeyLogin(h.client(), authenticator)).status, 401, "revoked passkey cannot sign in");
    assert.equal((await client.get("/api/auth/passkeys")).body.passkeys.length, 0);
  });
});
