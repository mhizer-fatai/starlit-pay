import { test } from "node:test";
import assert from "node:assert/strict";
import * as StellarSdk from "@stellar/stellar-sdk";
import { createSerialQueue } from "../src/relayer_account.js";
import { createCaptchaVerifier, createFaucetService, DRIP, FAUCET_COOLDOWN_MS } from "../src/modules/faucet/service.js";
import { createStatsService } from "../src/modules/stats/service.js";
import { ComplianceUnavailableError } from "../src/compliance.js";
import { poolAssetCode, USDC_ISSUER } from "../src/tokens.js";

const silent = { info() {}, warn() {}, error() {} };
const hex = "ab".repeat(32);

// --- relayer account queue ---

test("relayer transactions take turns, even when one fails", async () => {
  const run = createSerialQueue();
  const order = [];
  const task = (name, ms, fail) => () =>
    new Promise((resolve, reject) => {
      order.push(`start ${name}`);
      setTimeout(() => {
        order.push(`end ${name}`);
        fail ? reject(new Error(name)) : resolve(name);
      }, ms);
    });
  const results = await Promise.allSettled([run(task("a", 20)), run(task("b", 5, true)), run(task("c", 1))]);
  assert.deepEqual(order, ["start a", "end a", "start b", "end b", "start c", "end c"]);
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected", "fulfilled"]);
});

// --- faucet ---

function faucet({ claimedAt = null, memo = 147823, payError = null } = {}) {
  let clock = Date.parse("2026-11-03T12:00:00Z");
  const user = { id: "u1", deposit_memo: memo, faucet_claimed_at: claimedAt };
  const payments = [];
  const service = createFaucetService({
    repository: {
      findById: async () => user,
      findByViewingKey: async () => user,
      async claimCooldown(id, at, cutoff) {
        if (user.faucet_claimed_at && user.faucet_claimed_at >= cutoff) return false;
        user.faucet_claimed_at = at;
        return true;
      },
      restoreCooldown: async (id, previous) => (user.faucet_claimed_at = previous),
    },
    sendPayment: async (p) => {
      if (payError) throw payError;
      payments.push(p);
      return "faucet-tx";
    },
    verifyCaptcha: async (token) => {
      if (token !== "ok") throw Object.assign(new Error("captcha"), { status: 403 });
    },
    logger: silent,
    now: () => clock,
  });
  return { service, user, payments, advance: (ms) => (clock += ms) };
}

test("the faucet drips 10 XLM and 20 USDC to the user's own memo, once a day", async () => {
  const f = faucet();
  const result = await f.service.fund("u1", { captchaToken: "ok" });
  assert.equal(result.amountXlm, 10);
  assert.equal(result.amountUsdc, 20);
  assert.deepEqual(f.payments, [{ memo: "147823", ...DRIP }]);
  assert.equal(FAUCET_COOLDOWN_MS, 24 * 60 * 60 * 1000);
  f.advance(FAUCET_COOLDOWN_MS - 60_000);
  await assert.rejects(f.service.fund("u1", { captchaToken: "ok" }), { status: 429, code: "cooldown" });
  f.advance(60_001);
  await f.service.fund("u1", { captchaToken: "ok" });
  assert.equal(f.payments.length, 2);
});

test("two faucet claims at once pay out once", async () => {
  const f = faucet();
  const results = await Promise.allSettled([f.service.fund("u1", { captchaToken: "ok" }), f.service.fund("u1", { captchaToken: "ok" })]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.payments.length, 1);
});

test("a failed faucet payment gives the cooldown back", async () => {
  const f = faucet({ payError: new Error("rpc down") });
  await assert.rejects(f.service.fund("u1", { captchaToken: "ok" }), { status: 500 });
  assert.equal(f.user.faucet_claimed_at, null);
});

test("no captcha, no claim; and an account without a memo can't claim", async () => {
  await assert.rejects(faucet().service.fund("u1", { captchaToken: "bad" }), { status: 403 });
  await assert.rejects(faucet({ memo: null }).service.fund("u1", { captchaToken: "ok" }), { status: 400 });
});

test("the captcha is skipped until a secret is set; then the bypass works in development only", async () => {
  const unreachable = async () => {
    throw new Error("should not call Cloudflare");
  };
  await createCaptchaVerifier({ secret: undefined, production: true, fetchImpl: unreachable })(undefined);
  const fail = async () => ({ json: async () => ({ success: false }) });
  await createCaptchaVerifier({ secret: "real", production: false, fetchImpl: unreachable })("bypass-offline");
  await assert.rejects(createCaptchaVerifier({ secret: "real", production: true, fetchImpl: fail })("bypass-offline"), { status: 403 });
  await assert.rejects(createCaptchaVerifier({ secret: "real", production: true, fetchImpl: fail })(undefined), { status: 400 });
});

// --- stats ---

test("stats never invent a balance, and are cached", async () => {
  let reads = 0;
  let clock = 0;
  const stats = createStatsService({
    countNotes: async () => ({ notes: 10, transactions: 5 }),
    readPoolBalances: async () => {
      reads++;
      throw new Error("rpc down");
    },
    logger: silent,
    now: () => clock,
  });
  const first = await stats.get();
  assert.equal(first.tvlFormatted, null);
  assert.equal(first.notesCommitted, 10);
  assert.equal(first.zkProofsVerified, 5);
  await stats.get();
  assert.equal(reads, 1);
  clock += 61_000;
  await stats.get();
  assert.equal(reads, 2);
});

// --- pool assets ---

test("only native XLM and the pool's USDC count as pool assets", () => {
  assert.equal(poolAssetCode(StellarSdk.Asset.native()), "XLM");
  assert.equal(poolAssetCode(new StellarSdk.Asset("USDC", USDC_ISSUER)), "USDC");
  assert.equal(poolAssetCode(new StellarSdk.Asset("USDC", StellarSdk.Keypair.random().publicKey())), null);
});
