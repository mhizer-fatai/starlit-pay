import { test } from "node:test";
import assert from "node:assert/strict";
import * as StellarSdk from "@stellar/stellar-sdk";
import { createSerialQueue } from "../src/relayer_account.js";
import { createRelayerService } from "../src/modules/relayer/service.js";
import { createNotesService, verifyRequestSignature } from "../src/modules/notes/service.js";
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

// --- relayer service ---

const withdrawBody = { proof: hex, nullifier_1: hex, nullifier_2: hex, recipient: StellarSdk.Keypair.random().publicKey(), token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC", amount: 2.5, root: hex, change_commitment: hex, encrypted_change_note: "00" };

function relayer({ blocked = false, screenError = null, invokeError = null, misconfigured = null } = {}) {
  const calls = [];
  const service = createRelayerService({
    invoke: async (method, args) => {
      calls.push({ method, args });
      if (invokeError) throw invokeError;
      return { hash: "h1", ledger: 7 };
    },
    isAddressBlocked: async (address, opts) => {
      assert.equal(opts.failClosed, true);
      if (screenError) throw screenError;
      return blocked;
    },
    misconfigured,
    logger: silent,
  });
  return { service, calls };
}

test("a withdrawal passes nine contract arguments, amount in stroops", async () => {
  const { service, calls } = relayer();
  assert.deepEqual(await service.withdraw(withdrawBody), { hash: "h1", ledger: 7 });
  assert.equal(calls[0].method, "withdraw");
  assert.equal(calls[0].args.length, 9);
  assert.equal(StellarSdk.scValToNative(calls[0].args[5]), 25_000_000n);
});

test("a blocked recipient is refused before anything is submitted", async () => {
  const { service, calls } = relayer({ blocked: true });
  await assert.rejects(service.withdraw(withdrawBody), { status: 403 });
  assert.equal(calls.length, 0);
});

test("when screening can't answer, the withdrawal is refused (fail closed)", async () => {
  const { service, calls } = relayer({ screenError: new ComplianceUnavailableError("G", new Error("rpc down")) });
  await assert.rejects(service.withdraw(withdrawBody), { status: 503, code: "compliance_unavailable" });
  assert.equal(calls.length, 0);
});

test("chain errors reach the client as a plain message", async () => {
  const { service } = relayer({ invokeError: new Error("Simulation failed: HostError secret detail") });
  await assert.rejects(service.transfer({ proof: hex, nullifier_1: hex, nullifier_2: hex, output_commitment_1: hex, encrypted_note_1: "00", output_commitment_2: hex, encrypted_note_2: "00", root: hex }), (err) => {
    assert.equal(err.status, 500);
    assert.equal(err.message, "Could not submit the payment. Please try again.");
    return true;
  });
});

test("a misconfigured relayer says so without touching the chain", async () => {
  const { service, calls } = relayer({ misconfigured: "Relayer not initialized on the server." });
  await assert.rejects(service.withdraw(withdrawBody), { status: 500, message: "Relayer not initialized on the server." });
  assert.equal(calls.length, 0);
});

// --- notes ---

const owner = StellarSdk.Keypair.random();
function notes() {
  const store = new Map([[hex, { recipient_viewing_key: "vk", status: "unspent" }]]);
  const user = { id: "u1", stellar_address: owner.publicKey(), public_encryption_key: "vk" };
  const service = createNotesService({
    repository: {
      findUserByViewingKey: async (vk) => (vk === "vk" ? user : null),
      listNotes: async () => [...store.values()],
      insertNote: async (n) => n,
      findNote: async (c) => store.get(c) ?? null,
      markSpent: async (c) => (store.get(c).status = "spent"),
    },
    logger: silent,
  });
  return { service, store };
}
const signed = () => {
  const timestamp = String(Date.now());
  return { timestamp, signature: owner.sign(Buffer.from(timestamp)).toString("hex") };
};

test("only the owner reads notes: by session or by signature", async () => {
  const { service } = notes();
  assert.equal((await service.list("vk", "u1", {})).length, 1);
  assert.equal((await service.list("vk", null, signed())).length, 1);
  await assert.rejects(service.list("vk", "someone-else", {}), { status: 401 });
  await assert.rejects(service.list("vk", null, {}), { status: 401 });
  const stranger = StellarSdk.Keypair.random();
  const ts = String(Date.now());
  await assert.rejects(service.list("vk", null, { timestamp: ts, signature: stranger.sign(Buffer.from(ts)).toString("hex") }), { status: 401 });
});

test("only the owner marks a note spent", async () => {
  const { service, store } = notes();
  await assert.rejects(service.markSpent(hex, "someone-else", {}), { status: 401 });
  assert.equal(store.get(hex).status, "unspent");
  assert.deepEqual(await service.markSpent(hex, "u1", {}), { success: true });
  assert.equal((await service.markSpent(hex, "u1", {})).message, "Note already marked as spent.");
});

test("a request signature expires after a minute", () => {
  const { timestamp, signature } = signed();
  assert.equal(verifyRequestSignature(timestamp, signature, owner.publicKey()), true);
  assert.equal(verifyRequestSignature(timestamp, signature, owner.publicKey(), Date.now() + 61_000), false);
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
    countNotes: async () => ({ total: 10, spent: 4 }),
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
