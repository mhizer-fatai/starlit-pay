import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "@stellar/stellar-sdk";
import { createChannelPool, createChannelTopUp, deriveChannelKeypair, deriveChannelKeypairs, LEASE_MS } from "../src/channels.js";

const relayer = S.Keypair.random();

function pool({ count = 2, statuses = {} } = {}) {
  let clock = 1_000_000;
  let ids = 0;
  const channels = createChannelPool({
    keypairs: deriveChannelKeypairs(relayer, count),
    transactionStatus: async (hash) => statuses[hash] ?? "NOT_FOUND",
    now: () => clock,
    randomId: () => `lease-${++ids}`,
  });
  return { channels, advance: (ms) => (clock += ms), now: () => clock };
}

test("channel keys come from the relayer key: the same every time, and different per channel", () => {
  assert.equal(deriveChannelKeypair(relayer, 3).publicKey(), deriveChannelKeypair(relayer, 3).publicKey());
  assert.notEqual(deriveChannelKeypair(relayer, 0).publicKey(), deriveChannelKeypair(relayer, 1).publicKey());
  assert.notEqual(deriveChannelKeypair(S.Keypair.random(), 0).publicKey(), deriveChannelKeypair(relayer, 0).publicKey());
});

test("two people paying at once get different channels; a third waits", async () => {
  const { channels } = pool({ count: 2 });
  const ada = await channels.acquire("ada");
  const sam = await channels.acquire("sam");
  assert.notEqual(ada.address, sam.address);
  assert.equal(await channels.acquire("tolu"), null, "every channel is busy");
  assert.equal(channels.busy(), 2);
});

test("asking again returns your own channel, not a second one", async () => {
  const { channels } = pool({ count: 2 });
  const first = await channels.acquire("ada");
  const again = await channels.acquire("ada");
  assert.equal(again.leaseId, first.leaseId);
  assert.equal(channels.busy(), 1);
});

test("only the holder can sign with a lease", async () => {
  const { channels } = pool();
  const { leaseId, address } = await channels.acquire("ada");
  assert.equal(channels.keypairFor(leaseId, "ada").publicKey(), address);
  assert.equal(channels.keypairFor(leaseId, "sam"), null);
  assert.equal(channels.keypairFor("not-a-lease", "ada"), null);
});

test("a lease nobody used frees itself when it runs out", async () => {
  const { channels, advance } = pool({ count: 1 });
  await channels.acquire("ada");
  advance(LEASE_MS + 1);
  assert.ok(await channels.acquire("sam"), "the channel is free again");
});

test("a channel stays taken until what it signed has expired, even after the lease runs out", async () => {
  const { channels, advance, now } = pool({ count: 1 });
  const { leaseId } = await channels.acquire("ada");
  channels.signed(leaseId, { hash: "h1", maxTime: Math.floor(now() / 1000) + 300 });
  advance(LEASE_MS + 1);
  assert.equal(await channels.acquire("sam"), null, "ada's signed payment could still land");
  advance(300_000);
  assert.ok(await channels.acquire("sam"), "free once it can no longer land");
});

test("releasing frees the channel once its payment has landed, not before", async () => {
  const statuses = {};
  const { channels, now } = pool({ count: 1, statuses });
  const { leaseId } = await channels.acquire("ada");
  channels.signed(leaseId, { hash: "h1", maxTime: Math.floor(now() / 1000) + 300 });

  await channels.release(leaseId, "ada");
  assert.equal(await channels.acquire("sam"), null, "still in flight");

  statuses.h1 = "SUCCESS";
  assert.ok(await channels.acquire("sam"), "landed, so the channel moves on");
});

test("releasing a lease that signed nothing frees it at once; others can't release it", async () => {
  const { channels } = pool({ count: 1 });
  const { leaseId } = await channels.acquire("ada");
  await channels.release(leaseId, "sam");
  assert.equal(await channels.acquire("sam"), null, "only ada can release her lease");
  await channels.release(leaseId, "ada");
  assert.ok(await channels.acquire("sam"));
  assert.equal(channels.keypairFor(leaseId, "ada"), null, "a released lease can't sign again");
});

test("server tasks wait for a free channel and hand it back afterwards", async () => {
  const { channels, advance } = pool({ count: 1 });
  const ada = await channels.acquire("ada");
  const sleep = async (ms) => {
    advance(ms);
    await channels.release(ada.leaseId, "ada");
  };
  const used = await channels.run(async (keypair) => keypair.publicKey(), { sleep });
  assert.equal(used, ada.address);
  assert.equal(channels.busy(), 0, "handed back");
});

test("a server task gives up when every channel stays busy", async () => {
  const { channels, advance } = pool({ count: 1 });
  await channels.acquire("ada");
  await assert.rejects(
    channels.run(async () => "never", { waitMs: 1000, pollMs: 500, sleep: async (ms) => advance(ms) }),
    /busy/
  );
});

test("top-up creates missing channels and refills low ones, in one payment from the relayer", async () => {
  const [low, fine, missing] = deriveChannelKeypairs(relayer, 3).map((k) => k.publicKey());
  const balances = { [low]: "2.5", [fine]: "18" };
  const sent = [];
  const horizon = {
    loadAccount: async (address) => {
      if (!(address in balances)) throw Object.assign(new Error("not found"), { response: { status: 404 } });
      return { balances: [{ asset_type: "native", balance: balances[address] }] };
    },
  };
  const rpc = {
    getAccount: async (address) => new S.Account(address, "1"),
    sendTransaction: async (tx) => (sent.push(tx), { status: "PENDING", hash: "h" }),
  };
  const topUp = createChannelTopUp({ addresses: [low, fine, missing], relayerKeypair: relayer, horizon, rpc, networkPassphrase: S.Networks.TESTNET, logger: { info() {} } });

  assert.deepEqual(await topUp(), { created: 1, funded: 1 });
  const [tx] = sent;
  assert.equal(tx.source, relayer.publicKey());
  assert.deepEqual(
    tx.operations.map((op) => [op.type, op.destination, op.startingBalance ?? op.amount]),
    [["createAccount", missing, "20.0000000"], ["payment", low, "17.5000000"]]
  );

  balances[low] = "20";
  balances[missing] = "20";
  assert.deepEqual(await topUp(), { created: 0, funded: 0 });
  assert.equal(sent.length, 1, "nothing to send when every channel is funded");
});
