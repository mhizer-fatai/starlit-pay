import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import * as StellarSdk from "@stellar/stellar-sdk";
import { createUsersService } from "../src/modules/users/service.js";
import { createUsersRouter } from "../src/modules/users/routes.js";
import { createSettingsService, DEFAULT_SETTINGS } from "../src/modules/settings/service.js";
import { createPriceService } from "../src/modules/prices/service.js";
import { createPoolRootService } from "../src/modules/pool/service.js";
import { createRelayTokens } from "../src/modules/smart_wallet/relay_token.js";
import { createSmartWalletService } from "../src/modules/smart_wallet/service.js";
import { createSmartWalletRouter } from "../src/modules/smart_wallet/routes.js";
import { serve } from "./helpers/http.js";

const silent = { info() {}, warn() {}, error() {} };
const hex = (c) => c.repeat(64);

// --- users ---

describe("accounts", () => {
  const stored = { id: "u1", email: "alice@example.com", username: "alice", display_name: "Alice", avatar_url: "https://a/x.png", identity_commitment: hex("a") };
  let http;
  let users;
  let proven;

  before(async () => {
    users = new Map([[stored.email, stored]]);
    const repository = {
      findByEmail: async (email) => users.get(email) ?? null,
      findPublicByUsername: async (name) => (name === "alice" ? { id: "u1", username: "alice" } : null),
      depositMemoTaken: async () => false,
      insert: async (row) => (users.has(row.email) ? null : (users.set(row.email, { id: "u2", ...row }), users.get(row.email))),
      update: async (id, fields) => ({ ...stored, ...fields }),
    };
    const service = createUsersService({ repository, emailProofRequired: true, randomMemo: () => 123456 });
    const requireAuth = (req, res, next) => (req.headers["x-test-user"] ? ((req.user = { id: req.headers["x-test-user"] }), next()) : res.status(401).end());
    http = await serve(() => createUsersRouter({ service, requireAuth, provenEmail: async () => proven }));
  });
  after(() => http.close());

  const login = (body) => http.call("POST", "/api/auth/login", { body });

  test("nobody learns whether an email has an account without proving they own it", async () => {
    proven = null;
    const res = await login({ email: "alice@example.com" });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "email_proof_required");
    proven = "mallory@example.com";
    assert.equal((await login({ email: "alice@example.com" })).status, 401);
  });

  test("the owner of the email sees whether the account exists, never its secret", async () => {
    proven = "alice@example.com";
    const res = await login({ email: "Alice@Example.com " });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { exists: true, user: { username: "alice", display_name: "Alice", avatar_url: "https://a/x.png" } });
    proven = "nobody@example.com";
    assert.deepEqual((await login({ email: "nobody@example.com" })).body, { exists: false });
  });

  test("the old PIN check accepts only the right commitment, and never returns it", async () => {
    proven = "alice@example.com";
    assert.equal((await login({ email: "alice@example.com", identity_commitment: hex("b") })).status, 401);
    const ok = await login({ email: "alice@example.com", identity_commitment: hex("a") });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.identity_commitment, undefined);
  });

  const registration = (over = {}) => ({
    email: "bob@example.com",
    username: "@Bob",
    identity_commitment: hex("c"),
    public_encryption_key: hex("d"),
    stellar_address: StellarSdk.Keypair.random().publicKey(),
    ...over,
  });

  test("registration needs the email's owner, valid keys and a clean username", async () => {
    proven = "bob@example.com";
    assert.equal((await http.call("POST", "/api/users/register", { body: registration({ username: "bad name!" }) })).status, 400);
    assert.equal((await http.call("POST", "/api/users/register", { body: registration({ public_encryption_key: "zz" }) })).status, 400);
    assert.equal((await http.call("POST", "/api/users/register", { body: registration({ avatar_url: "javascript:alert(1)" }) })).status, 400);
    proven = "mallory@example.com";
    assert.equal((await http.call("POST", "/api/users/register", { body: registration() })).status, 401);

    proven = "bob@example.com";
    const res = await http.call("POST", "/api/users/register", { body: registration() });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.username, "bob");
    assert.equal(res.body.user.deposit_memo, 123456);
    assert.equal(res.body.user.identity_commitment, undefined);
    assert.equal((await http.call("POST", "/api/users/register", { body: registration() })).status, 400);
  });

  test("lookup finds users by username, with or without @, and refuses Stellar keys", async () => {
    assert.equal((await http.call("GET", "/api/users/lookup/@Alice")).body.user.username, "alice");
    assert.equal((await http.call("GET", "/api/users/lookup/nobody")).status, 404);
    assert.equal((await http.call("GET", `/api/users/lookup/${StellarSdk.Keypair.random().publicKey()}`)).status, 400);
  });

  test("profile edits are signed-in, validated, and never touch identity fields", async () => {
    assert.equal((await http.call("PATCH", "/api/users/me", { body: { display_name: "A" } })).status, 401);
    assert.equal((await http.call("PATCH", "/api/users/me", { as: "u1", body: {} })).status, 400);
    assert.equal((await http.call("PATCH", "/api/users/me", { as: "u1", body: { display_name: "  " } })).status, 400);
    const res = await http.call("PATCH", "/api/users/me", { as: "u1", body: { display_name: " New ", username: "hijack", email: "x@y.z" } });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.display_name, "New");
    assert.equal(res.body.user.username, "alice");
  });
});

// --- settings ---

test("settings: defaults on first read, updates touch only the named fields", async () => {
  let row = null;
  const service = createSettingsService({
    repository: { find: async () => row, save: async (r) => (row = r) },
    now: () => new Date(0),
  });
  assert.deepEqual(await service.get("u1"), { user_id: "u1", ...DEFAULT_SETTINGS });
  const updated = await service.update("u1", { currency: "EUR", notif_sms: undefined });
  assert.equal(updated.currency, "EUR");
  assert.equal(updated.notif_sms, false);
  assert.equal(updated.language, "en");
});

// --- prices ---

test("prices: never invented, cached, one refresh at a time", async () => {
  let calls = 0;
  let clock = 1_000_000;
  let answer = null;
  const service = createPriceService({
    fetchPrices: async () => {
      calls++;
      if (!answer) throw new Error("all sources down");
      return answer;
    },
    logger: silent,
    now: () => clock,
  });
  const down = await service.current();
  assert.equal(down.XLM, null);
  assert.equal(down.stale, true);

  answer = { USDC: 1, XLM: 0.31, source: "stellar-dex" };
  clock += 61_000;
  const [a, b] = await Promise.all([service.current(), service.current()]);
  assert.equal(a.XLM, 0.31);
  assert.equal(b.XLM, 0.31);
  assert.equal(calls, 2);
});

// --- pool root ---

test("pool root: the newest root the pool accepts, cached", async () => {
  let checks = 0;
  const service = createPoolRootService({
    recentRoots: async () => ["nothex", hex("1"), hex("1"), hex("2")],
    isRootValid: async (root) => (checks++, root === hex("2")),
  });
  assert.equal(await service.current(), hex("2"));
  assert.equal(checks, 2);
  await service.current();
  assert.equal(checks, 2);
});

// --- smart wallet relay ---

test("relay tokens: only valid, unexpired and unforged tokens name a user", () => {
  let clock = 0;
  const tokens = createRelayTokens("s".repeat(32), () => clock);
  const { token } = tokens.mint("u1");
  assert.equal(tokens.read(token), "u1");
  const forged = Buffer.from(Buffer.from(token, "base64url").toString().replace("u1", "u2")).toString("base64url");
  assert.equal(tokens.read(forged), null);
  assert.equal(createRelayTokens("t".repeat(32), () => clock).read(token), null);
  clock = 11 * 60 * 1000;
  assert.equal(tokens.read(token), null);
  assert.equal(createRelayTokens(undefined), null);
});

describe("smart wallet relay endpoint", () => {
  let http;
  before(async () => {
    const tokens = createRelayTokens("s".repeat(32));
    const service = createSmartWalletService({
      repository: { findUser: async () => ({ id: "u1" }), activePasskeys: async () => [] },
      chain: { sponsoring: true, sponsor: async () => ({ hash: "h", ledger: 1 }) },
      tokens,
      config: { networkPassphrase: StellarSdk.Networks.TESTNET },
      logger: silent,
    });
    http = await serve(({ requireAuth }) => createSmartWalletRouter({ service, requireAuth, logger: silent }));
    http.token = tokens.mint("u1").token;
  });
  after(() => http.close());

  test("keeps the shape smart-account-kit reads, for rule failures and bad tokens", async () => {
    const expired = await http.call("POST", "/api/smart-wallet/relay/garbage", { body: {} });
    assert.equal(expired.status, 401);
    assert.deepEqual(expired.body, { success: false, error: "This request expired. Please try again.", code: "RELAY_TOKEN_INVALID" });

    const refused = await http.call("POST", `/api/smart-wallet/relay/${http.token}`, { body: { func: "not a transaction" } });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.success, false);
    assert.equal(refused.body.code, "NOT_SPONSORED");
  });

  test("a wallet's birth record needs a real transaction hash", async () => {
    assert.equal((await http.call("POST", "/api/smart-wallet/birth", { as: "u1", body: { txHash: "nope" } })).status, 400);
  });
});

