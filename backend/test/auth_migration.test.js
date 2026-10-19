import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { startHarness } from "./helpers/harness.js";
import { createSoftAuthenticator } from "./helpers/soft_authenticator.js";

const EMAIL_PROOF = { "x-supabase-auth": "google-token-alice" };
const b64u32 = () => crypto.randomBytes(32).toString("base64url");
const hex32 = () => crypto.randomBytes(32).toString("hex");
const fakeWrap = () => crypto.randomBytes(60).toString("base64url");
const HOUR = 60 * 60 * 1000;

let h;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(async () => {
  await h.close();
});

async function enrol(authenticator = createSoftAuthenticator(), client = h.client()) {
  const opts = await client.post("/api/auth/passkey/register/options", {}, { headers: EMAIL_PROOF });
  const res = await client.post("/api/auth/passkey/register/verify", {
    challengeId: opts.body.challengeId,
    response: authenticator.register(opts.body.options),
    deviceName: "Phone",
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { client, authenticator, passkey: res.body.passkey };
}

const newKeys = () => ({
  publicEncryptionKey: hex32(),
  stellarAddress: Keypair.random().publicKey(),
  identityCommitment: hex32(),
});

describe("migrating profile keys", () => {
  test("a migrating vault can point the profile at its keys exactly once", async () => {
    const { client } = await enrol();
    assert.equal((await client.post("/api/vault", { encryptedSeed: fakeWrap() })).status, 201);

    const keys = newKeys();
    const res = await client.post("/api/vault/migrate/profile-keys", keys);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const user = h.store.db.users.get(h.alice.id);
    assert.equal(user.public_encryption_key, keys.publicEncryptionKey);
    assert.equal(user.stellar_address, keys.stellarAddress);
    assert.equal(user.identity_commitment, keys.identityCommitment);
    assert.equal(res.body.user.identity_commitment, undefined);
    assert.ok(h.sentAlerts.some((a) => a.event === "keys_migrated"));

    const again = await client.post("/api/vault/migrate/profile-keys", newKeys());
    assert.equal(again.status, 409);
    assert.equal(h.store.db.users.get(h.alice.id).public_encryption_key, keys.publicEncryptionKey);
  });

  test("a new sign-up vault is bound at creation, so its keys can never be swapped", async () => {
    const { client } = await enrol();
    await client.post("/api/vault", { encryptedSeed: fakeWrap(), profileBound: true });
    const res = await client.post("/api/vault/migrate/profile-keys", newKeys());
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "already_bound");
  });

  test("needs a fresh sign-in and valid keys", async () => {
    const { client } = await enrol();
    await client.post("/api/vault", { encryptedSeed: fakeWrap() });
    assert.equal((await client.post("/api/vault/migrate/profile-keys", { ...newKeys(), stellarAddress: "GBAD" })).status, 400);
    assert.equal((await client.post("/api/vault/migrate/profile-keys", { ...newKeys(), publicEncryptionKey: "xyz" })).status, 400);
    h.advance(6 * 60 * 1000);
    await client.post("/api/auth/refresh");
    const stale = await client.post("/api/vault/migrate/profile-keys", newKeys());
    assert.equal(stale.body.code, "reauth_required");
  });
});

describe("recovery code unlock", () => {
  async function setUpRecovery() {
    const enrolled = await enrol();
    const recoveryWrap = fakeWrap();
    const codeVerifier = b64u32();
    await enrolled.client.post("/api/vault", { encryptedSeed: fakeWrap(), profileBound: true });
    const set = await enrolled.client.post("/api/vault/recovery", { codeVerifier, wrappedDek: recoveryWrap });
    assert.equal(set.status, 200);
    return { ...enrolled, codeVerifier, recoveryWrap };
  }

  test("the right code with Google proof releases the recovery wrap and signs in", async () => {
    const { codeVerifier, recoveryWrap } = await setUpRecovery();
    const device = h.client();
    const res = await device.post("/api/vault/recovery/unlock", { codeVerifier }, { headers: EMAIL_PROOF });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.wrappedDek, recoveryWrap);
    assert.ok(res.body.vault.encryptedSeed);
    assert.deepEqual((await device.get("/api/auth/session")).body.amr, ["recovery"]);
    assert.ok(h.sentAlerts.some((a) => a.event === "recovery_used" && a.to === h.alice.email));
  });

  test("each code works only once", async () => {
    const { codeVerifier } = await setUpRecovery();
    assert.equal((await h.client().post("/api/vault/recovery/unlock", { codeVerifier }, { headers: EMAIL_PROOF })).status, 200);
    assert.equal((await h.client().post("/api/vault/recovery/unlock", { codeVerifier }, { headers: EMAIL_PROOF })).status, 401);
  });

  test("simultaneous uses of one code: only one succeeds", async () => {
    const { codeVerifier } = await setUpRecovery();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => h.client().post("/api/vault/recovery/unlock", { codeVerifier }, { headers: EMAIL_PROOF }))
    );
    assert.equal(results.filter((r) => r.status === 200).length, 1);
  });

  test("a wrong code or missing Google proof is refused", async () => {
    const { codeVerifier } = await setUpRecovery();
    assert.equal((await h.client().post("/api/vault/recovery/unlock", { codeVerifier: b64u32() }, { headers: EMAIL_PROOF })).status, 401);
    const noProof = await h.client().post("/api/vault/recovery/unlock", { codeVerifier });
    assert.equal(noProof.status, 401);
    assert.equal(noProof.body.code, "email_proof_required");
    // the real code still works afterwards
    assert.equal((await h.client().post("/api/vault/recovery/unlock", { codeVerifier }, { headers: EMAIL_PROOF })).status, 200);
  });

  test("a passkey added after recovery waits 24 hours and the owner is alerted", async () => {
    const { codeVerifier } = await setUpRecovery();
    const device = h.client();
    await device.post("/api/vault/recovery/unlock", { codeVerifier }, { headers: EMAIL_PROOF });

    const fresh = createSoftAuthenticator();
    const opts = await device.post("/api/auth/passkey/register/options", {});
    assert.equal(opts.status, 200, JSON.stringify(opts.body));
    const added = await device.post("/api/auth/passkey/register/verify", {
      challengeId: opts.body.challengeId,
      response: fresh.register(opts.body.options),
      deviceName: "New phone",
    });
    assert.equal(added.status, 201);
    assert.equal(added.body.passkey.pending, true);
    assert.ok(h.sentAlerts.some((a) => a.event === "passkey_added" && a.details.pending === true));

    const tryLogin = async () => {
      const lo = await h.client().post("/api/auth/passkey/login/options", {});
      return h.client().post("/api/auth/passkey/login/verify", { challengeId: lo.body.challengeId, response: fresh.assert(lo.body.options) });
    };
    assert.equal((await tryLogin()).status, 403);
    h.advance(25 * HOUR);
    assert.equal((await tryLogin()).status, 200);
  });

  test("passkeys added from a normal passkey session are active immediately", async () => {
    const { client } = await enrol();
    const opts = await client.post("/api/auth/passkey/register/options", {});
    const added = await client.post("/api/auth/passkey/register/verify", {
      challengeId: opts.body.challengeId,
      response: createSoftAuthenticator().register(opts.body.options),
    });
    assert.equal(added.body.passkey.pending, false);
  });
});

describe("alerts", () => {
  test("a PIN lockout emails the owner", async () => {
    const { client } = await enrol();
    await client.post("/api/vault", { encryptedSeed: fakeWrap(), profileBound: true });
    const begin = await client.post("/api/vault/pin/setup/begin", {});
    await client.post("/api/vault/pin/setup/complete", { ticket: begin.body.ticket, pinVerifier: b64u32(), wrappedDek: fakeWrap() });
    for (let i = 0; i < 5; i++) await h.client().post("/api/vault/pin/unlock", { pinVerifier: b64u32() }, { headers: EMAIL_PROOF });
    const lock = h.sentAlerts.find((a) => a.event === "pin_locked");
    assert.ok(lock);
    assert.equal(lock.details.lockSeconds, 900);
  });
});
