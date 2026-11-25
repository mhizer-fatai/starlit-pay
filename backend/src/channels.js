import crypto from "node:crypto";
import * as StellarSdk from "@stellar/stellar-sdk";

// Channel accounts: extra Stellar accounts that send transactions in parallel.
//
// A Stellar account's transactions must use its sequence numbers in strict
// order, so one account sends one transaction at a time: two built at once
// read the same number and one is rejected. Each channel has its own numbers,
// so N channels carry N transactions at the same moment.
//
// A channel is leased to one user (or one server task) at a time. The lease
// lasts while they build and prove a payment, and for as long as anything the
// channel signed for them could still land (until its expiry), so no one else
// can take that channel's next sequence number in the meantime.
//
// Channel keys are derived from the relayer's key, so there is nothing new to
// store: channel i is the same account on every restart.

/** Channel i's keypair, derived from the relayer's secret. */
export function deriveChannelKeypair(relayerKeypair, index) {
  const seed = crypto.createHmac("sha256", relayerKeypair.rawSecretKey()).update(`starlit:channel:${index}`).digest();
  return StellarSdk.Keypair.fromRawEd25519Seed(seed);
}

export function deriveChannelKeypairs(relayerKeypair, count) {
  return Array.from({ length: count }, (_, i) => deriveChannelKeypair(relayerKeypair, i));
}

// Long enough to sync, prove (up to ~40 s on a phone) and sign a payment.
export const LEASE_MS = 3 * 60 * 1000;
// After a signed transaction expires, give the network time to report it.
const EXPIRY_GRACE_MS = 30 * 1000;

/**
 * The pool of channels. `transactionStatus(hash)` answers SUCCESS, FAILED or
 * anything else (still unknown); it lets a lease end early once everything
 * its channel signed has landed or failed.
 */
export function createChannelPool({ keypairs, transactionStatus, now = Date.now, leaseMs = LEASE_MS, randomId = () => crypto.randomUUID() }) {
  const channels = keypairs.map((keypair) => ({ keypair, address: keypair.publicKey(), lease: null }));
  // Off until every channel is known to exist on the network (the first top-up).
  let ready = false;

  // Busy until the lease runs out, and until anything it signed has expired.
  const busyUntil = (lease) => Math.max(lease.until, lease.signedUntil);
  const isFree = (channel) => !channel.lease || busyUntil(channel.lease) <= now();

  /** Ends a lease early when every transaction it signed has landed or failed. */
  async function settle(channel) {
    const { lease } = channel;
    if (!lease || !lease.released || !lease.hashes.length) return;
    const statuses = await Promise.all(lease.hashes.map((hash) => Promise.resolve(transactionStatus(hash)).catch(() => "UNKNOWN")));
    if (channel.lease === lease && statuses.every((s) => s === "SUCCESS" || s === "FAILED")) channel.lease = null;
  }

  const find = (leaseId) => channels.find((c) => c.lease?.id === leaseId) ?? null;

  return {
    size: channels.length,
    addresses: channels.map((c) => c.address),

    /** Channels are used only once they all exist; until then the relayer works alone. */
    isReady: () => ready,
    setReady() {
      ready = true;
    },

    /**
     * Leases a free channel to `holder`, or returns null when every channel is
     * busy. A holder that already has a live lease gets the same one back.
     */
    async acquire(holder) {
      const mine = channels.find((c) => c.lease?.holder === holder && !c.lease.released && !isFree(c));
      if (mine) {
        mine.lease.until = Math.max(mine.lease.until, now() + leaseMs);
        return { leaseId: mine.lease.id, address: mine.address, expiresAt: busyUntil(mine.lease) };
      }
      await Promise.all(channels.filter((c) => c.lease?.released).map(settle));
      const channel = channels.find(isFree);
      if (!channel) return null;
      channel.lease = { id: randomId(), holder, until: now() + leaseMs, signedUntil: 0, hashes: [], released: false };
      return { leaseId: channel.lease.id, address: channel.address, expiresAt: channel.lease.until };
    },

    /**
     * The keypair for signing under a lease, only for its holder. A lease that
     * ran out still works if no one else has taken the channel since.
     */
    keypairFor(leaseId, holder) {
      const channel = find(leaseId);
      if (!channel || channel.lease.holder !== holder || channel.lease.released) return null;
      channel.lease.until = Math.max(channel.lease.until, now() + leaseMs);
      return channel.keypair;
    },

    /** Records a transaction signed under a lease: the channel stays theirs until it expires. */
    signed(leaseId, { hash, maxTime }) {
      const channel = find(leaseId);
      if (!channel) return;
      channel.lease.hashes.push(hash);
      channel.lease.signedUntil = Math.max(channel.lease.signedUntil, maxTime * 1000 + EXPIRY_GRACE_MS);
    },

    /** The holder is done. The channel frees once what it signed has landed or failed (or expired). */
    async release(leaseId, holder) {
      const channel = find(leaseId);
      if (!channel || channel.lease.holder !== holder) return;
      channel.lease.released = true;
      channel.lease.until = now();
      if (!channel.lease.hashes.length) channel.lease = null;
      else await settle(channel);
    },

    /**
     * Runs a server task (the faucet) on a channel, waiting up to `waitMs` for
     * one to free up. The task must wait for its transaction's outcome itself.
     */
    async run(task, { waitMs = 30_000, pollMs = 500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
      const holder = `server:${randomId()}`;
      const deadline = now() + waitMs;
      let lease = await this.acquire(holder);
      while (!lease) {
        if (now() >= deadline) throw new Error("All channels are busy.");
        await sleep(pollMs);
        lease = await this.acquire(holder);
      }
      const channel = find(lease.leaseId);
      try {
        return await task(channel.keypair);
      } finally {
        // The task waited for its outcome, so the channel is free straight away.
        if (channel.lease?.id === lease.leaseId) channel.lease = null;
      }
    },

    /** How many channels are leased right now (for the health check). */
    busy() {
      return channels.filter((c) => !isFree(c)).length;
    },
  };
}

/**
 * Keeps each channel's XLM (it pays its own network fees) between `min` and
 * `target`, from the relayer, in one transaction. A channel that doesn't exist
 * yet is created with `target` XLM, so the server sets up its own channels
 * the first time it runs with them.
 */
export function createChannelTopUp({ addresses, relayerKeypair, horizon, rpc, networkPassphrase, logger, min = 5, target = 20 }) {
  return async function topUp() {
    const create = [];
    const fund = [];
    for (const address of addresses) {
      try {
        const account = await horizon.loadAccount(address);
        const balance = parseFloat(account.balances.find((b) => b.asset_type === "native")?.balance ?? "0");
        if (balance < min) fund.push({ address, amount: (target - balance).toFixed(7) });
      } catch (err) {
        if (err?.response?.status !== 404) throw err;
        create.push(address);
      }
    }
    if (!create.length && !fund.length) return { created: 0, funded: 0 };

    const account = await rpc.getAccount(relayerKeypair.publicKey());
    const builder = new StellarSdk.TransactionBuilder(account, { fee: "1000", networkPassphrase });
    for (const destination of create) {
      builder.addOperation(StellarSdk.Operation.createAccount({ destination, startingBalance: String(target) }));
    }
    for (const { address, amount } of fund) {
      builder.addOperation(StellarSdk.Operation.payment({ destination: address, asset: StellarSdk.Asset.native(), amount }));
    }
    const tx = builder.setTimeout(60).build();
    tx.sign(relayerKeypair);
    const sent = await rpc.sendTransaction(tx);
    if (sent.status === "ERROR") throw new Error(`Channel top-up rejected: ${JSON.stringify(sent.errorResult ?? sent.status)}`);
    logger.info(`Channels: created ${create.length}, topped up ${fund.length} from the relayer`, { tx: sent.hash });
    return { created: create.length, funded: fund.length };
  };
}
