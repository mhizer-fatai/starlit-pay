import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as S from "@stellar/stellar-sdk";
import { createPaymentLinksService } from "../src/modules/payment_links/service.js";
import { createPaymentLinksRouter } from "../src/modules/payment_links/routes.js";
import { createTransactionReader } from "../src/modules/payment_links/chain.js";
import { serve } from "./helpers/http.js";

const GATEWAY = "GCDQQE7CPLIGMAH4QEB2SSIEAS5MZMFSQAYSEJYSF7P5ZLA6HOU4BWWY";
const RELAYER = "GDZRT3OE4WEOA4AJQ3IV5S2AR7X7YXI5LFY52JA3ASDEELA6W6H32FYX";
const POOL = "CAHSOWD7JVCRO4U73MGXRET7DRJDM3K2CFS5EGYARWDEGACHWSR6ZEZM";
const NOW = Date.parse("2026-11-02T12:00:00Z");
const HASH = "a".repeat(64);
const claimUrl = "/api/payment-links/c1/claim";

const walletPayment = (over = {}) => ({
  successful: true,
  source: "GPAYER",
  memo: "147823",
  createdAt: NOW - 60_000,
  payments: [{ destination: GATEWAY, asset: "USDC", amount: 10 }],
  contractCalls: [],
  ...over,
});
const relayerPayment = (fn = "transfer", over = {}) => ({
  successful: true,
  source: RELAYER,
  memo: null,
  createdAt: NOW - 60_000,
  payments: [],
  contractCalls: [{ contract: POOL, fn }],
  ...over,
});

describe("payment links", () => {
  let http;
  let link;
  let chainTx;
  let claims;
  let usedHashes;

  const repository = {
    create: async (row) => ({ id: "l1", ...row }),
    findByCommitment: async (commitment) => (commitment === "c1" ? link : null),
    markClaimed: async (commitment, txHash) => {
      claims += 1;
      if (usedHashes.has(txHash)) return "hash_used";
      if (link.status !== "pending") return null;
      usedHashes.add(txHash);
      link.status = "claimed";
      return link;
    },
  };

  before(async () => {
    const service = createPaymentLinksService({
      repository,
      readTransaction: async () => chainTx,
      gatewayAddress: GATEWAY,
      relayerAddress: RELAYER,
      poolContract: POOL,
      now: () => NOW,
    });
    http = await serve(({ requireAuth, currentUser }) => createPaymentLinksRouter({ service, requireAuth, currentUser }));
  });
  after(() => http.close());
  beforeEach(() => {
    claims = 0;
    usedHashes = new Set();
    chainTx = walletPayment();
    link = {
      commitment: "c1",
      status: "pending",
      amount: "10",
      asset: "USDC",
      created_at: new Date(NOW - 5 * 60_000).toISOString(),
      creator: { deposit_memo: 147823 },
    };
  });

  const claim = (body, as) => http.call("POST", claimUrl, { body, as });
  const refused = (res) => {
    assert.equal(res.status, 400);
    assert.equal(link.status, "pending");
  };

  test("an outside wallet payment claims the link without a Starlit account", async () => {
    const res = await claim({ txHash: HASH });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
    assert.equal(link.status, "claimed");
  });

  test("a claim needs a real transaction: no hash, garbage, or an unknown hash are refused", async () => {
    refused(await claim({}));
    refused(await claim({ txHash: "not-a-hash" }));
    chainTx = null;
    refused(await claim({ txHash: HASH }));
  });

  test("a failed transaction doesn't claim", async () => {
    chainTx = walletPayment({ successful: false });
    refused(await claim({ txHash: HASH }));
  });

  test("a wallet payment must carry the owner's memo, the right asset and enough money", async () => {
    for (const tx of [
      walletPayment({ memo: "999999" }),
      walletPayment({ memo: null }),
      walletPayment({ payments: [{ destination: "GOTHER", asset: "USDC", amount: 10 }] }),
      walletPayment({ payments: [{ destination: GATEWAY, asset: "XLM", amount: 10 }] }),
      walletPayment({ payments: [{ destination: GATEWAY, asset: "USDC", amount: 9.99 }] }),
    ]) {
      chainTx = tx;
      refused(await claim({ txHash: HASH }));
    }
  });

  test("a payment made before the link existed doesn't claim it", async () => {
    chainTx = walletPayment({ createdAt: NOW - 60 * 60_000 });
    refused(await claim({ txHash: HASH }));
  });

  test("a signed-in user's private payment claims the link", async () => {
    chainTx = relayerPayment("withdraw");
    const res = await claim({ txHash: HASH }, "bob");
    assert.equal(res.status, 200);
    assert.equal(link.status, "claimed");
  });

  test("relayer transactions don't claim anonymously, nor unrelated relayer activity", async () => {
    chainTx = relayerPayment();
    refused(await claim({ txHash: HASH }));
    chainTx = relayerPayment("bump");
    refused(await claim({ txHash: HASH }, "bob"));
    chainTx = relayerPayment("transfer", { source: "GSOMEONEELSE" });
    refused(await claim({ txHash: HASH }, "bob"));
  });

  test("a claimed or expired link can't be claimed again", async () => {
    link.status = "claimed";
    assert.equal((await claim({ txHash: HASH })).status, 400);
    assert.equal(claims, 0);

    link.status = "pending";
    link.created_at = new Date(NOW - 31 * 60_000).toISOString();
    refused(await claim({ txHash: HASH }));
  });

  test("two simultaneous claims: only one wins", async () => {
    const results = await Promise.all([claim({ txHash: HASH }), claim({ txHash: HASH })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  });

  test("one payment settles one link only", async () => {
    assert.equal((await claim({ txHash: HASH })).status, 200);
    link = { ...link, status: "pending" }; // a second link, same owner, same amount
    const again = await claim({ txHash: HASH.toUpperCase() });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, "payment_already_used");
    assert.equal(link.status, "pending");
  });

  test("unknown links are 404, and viewing a link still reports expiry", async () => {
    assert.equal((await http.call("POST", "/api/payment-links/nope/claim", { body: { txHash: HASH } })).status, 404);
    assert.equal((await http.call("GET", "/api/payment-links/nope")).status, 404);
    link.created_at = new Date(NOW - 31 * 60_000).toISOString();
    assert.equal((await http.call("GET", "/api/payment-links/c1")).body.link.status, "expired");
  });

  test("only the signed-in owner creates a link", async () => {
    const body = { creator_id: "alice", amount: 5, commitment: "ab".repeat(16) };
    assert.equal((await http.call("POST", "/api/payment-links", { body })).status, 401);
    assert.equal((await http.call("POST", "/api/payment-links", { body, as: "bob" })).status, 403);
    const res = await http.call("POST", "/api/payment-links", { body, as: "alice" });
    assert.equal(res.status, 201);
    assert.equal(res.body.link.asset, "USDC");
    assert.equal(res.body.link.status, "pending");
  });
});

describe("reading a transaction from the network", () => {
  const NP = S.Networks.TESTNET;
  const source = S.Keypair.random().publicKey();
  const build = (op, memo = S.Memo.none()) =>
    new S.TransactionBuilder(new S.Account(source, "1"), { fee: "100", networkPassphrase: NP, memo }).addOperation(op).setTimeout(30).build();
  const reader = (tx, status = "SUCCESS") =>
    createTransactionReader({
      rpc: { getTransaction: async () => ({ status, envelopeXdr: tx?.toEnvelope().toXDR("base64"), createdAt: 1000 }) },
      networkPassphrase: NP,
    });

  test("a look-alike USDC from another issuer is not USDC", async () => {
    const fake = new S.Asset("USDC", S.Keypair.random().publicKey());
    const tx = build(S.Operation.payment({ destination: GATEWAY, asset: fake, amount: "10" }), S.Memo.id("147823"));
    assert.notEqual((await reader(tx)("hash")).payments[0].asset, "USDC");
  });

  test("extracts a memo payment", async () => {
    const usdc = new S.Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
    const tx = build(S.Operation.payment({ destination: GATEWAY, asset: usdc, amount: "12.5" }), S.Memo.id("147823"));
    const result = await reader(tx)("hash");
    assert.equal(result.successful, true);
    assert.equal(result.source, source);
    assert.equal(result.memo, "147823");
    assert.equal(result.createdAt, 1_000_000);
    assert.deepEqual(result.payments, [{ destination: GATEWAY, asset: "USDC", amount: 12.5 }]);
  });

  test("names XLM and ignores non-id memos", async () => {
    const tx = build(S.Operation.payment({ destination: GATEWAY, asset: S.Asset.native(), amount: "1" }), S.Memo.text("hi"));
    const result = await reader(tx)("hash");
    assert.equal(result.memo, null);
    assert.equal(result.payments[0].asset, "XLM");
  });

  test("extracts contract calls, and reports failures and unknown hashes", async () => {
    const tx = build(new S.Contract(POOL).call("withdraw"));
    assert.deepEqual((await reader(tx)("hash")).contractCalls, [{ contract: POOL, fn: "withdraw" }]);
    assert.equal((await reader(tx, "FAILED")("hash")).successful, false);
    assert.equal(await reader(null, "NOT_FOUND")("hash"), null);
  });
});
