// Private payments with real zero-knowledge proofs, through Nethermind's
// Stellar Private Payments (SPP) browser SDK and Starlit's own pools.
//
// The SDK is served as static files from /zk/spp (built from source by the
// spp-sdk workflow) and loaded on first use: it starts its own workers and
// fetches its wasm and circuit files relative to itself, which bundling would
// break. Proofs are made in the browser; nothing secret leaves the device.

import * as StellarSdk from "@stellar/stellar-sdk";

import { BACKEND_URL, BackendError, getZkPayer, lookupZkKeys, publishZkKeys, signWithZkPayer, type ZkKeys } from "@/lib/backend";
import { createOwnerSigner, createZkSigner, deriveZkStorageKey, signZkKeys, zkKeysSignedBy } from "@/lib/zkSigner";
import type * as Spp from "../../public/zk/spp/js/types/index";

import deploymentJson from "./spp/deployment.testnet.json";
// Trusted fingerprints ship inside the app, so the server hosting the circuit
// files can't swap both the files and the fingerprints.
import circuitLock from "./spp/circuits.lock.json";

const SDK_BASE = "/zk/spp/";
const RPC_URL = (import.meta.env.VITE_STELLAR_RPC_URL as string | undefined) || "https://soroban-testnet.stellar.org";

const deployment = deploymentJson as Spp.ContractConfigInput & { networkPassphrase: string };

export type PoolAsset = "XLM" | "USDC";
const POOLS: Record<PoolAsset, string> = {
  XLM: deployment.pools[0].poolContractId,
  USDC: deployment.pools[1].poolContractId,
};

type SppModule = typeof Spp;

let sdk: Promise<SppModule> | null = null;
function loadSdk(): Promise<SppModule> {
  sdk ??= (async () => {
    const mod = (await import(/* @vite-ignore */ new URL(`${SDK_BASE}js/index.js`, window.location.origin).href)) as SppModule;
    await mod.default();
    return mod;
  })().catch((err) => {
    sdk = null;
    throw err;
  });
  return sdk;
}

/**
 * Each wallet gets its own encrypted database folder, so two Starlit accounts
 * on one device don't collide. The SDK wants a UUID-shaped suffix.
 */
export async function storageDirectory(ownerAddress: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`starlit:zk:${ownerAddress}`)));
  const hex = Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `.opfs-sahpool-encrypted-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface PrivateSession {
  owner: string;
  account: Spp.Account;
  /** Others can pay this user by username (their signed keys are published). */
  keysPublished: boolean;
  /** Catches up with the pools now (background sync keeps going on its own). */
  sync(): Promise<void>;
  pool(asset: PoolAsset): Promise<Spp.PrivatePool>;
  /**
   * The pool, with another Starlit account as the transaction's source and
   * pool sender (the gateway, for deposits it pays in). Free it after use.
   */
  poolSignedBy(asset: PoolAsset, signer: Payer): Promise<{ pool: Spp.PrivatePool; free(): void }>;
  close(): Promise<void>;
}

let session: { owner: string; ready: Promise<PrivateSession> } | null = null;

export interface Payer {
  address(): Promise<string>;
  sign(xdr: string): Promise<{ signedTxXdr: string }>;
}

export interface SessionOptions {
  payer?: Payer;
  publish?: (keys: ZkKeys) => Promise<unknown>;
  rpcUrl?: string;
  /** Starlit's archive of the pools' history (Stellar RPC keeps ~7 days). */
  historyUrl?: string;
}

const defaults: Required<SessionOptions> = {
  payer: { address: async () => (await getZkPayer()).address, sign: signWithZkPayer },
  publish: publishZkKeys,
  rpcUrl: RPC_URL,
  historyUrl: `${BACKEND_URL}/api/zk/history`,
};

/**
 * Opens (once per page) the private-pool session for an unlocked wallet.
 * The first open on a device creates the encrypted local database and syncs
 * the pools; later opens reuse it.
 */
export function openPrivateSession(stellarSecretKey: string, options: SessionOptions = {}): Promise<PrivateSession> {
  const { payer, publish, rpcUrl, historyUrl } = { ...defaults, ...options };
  const owner = StellarSdk.Keypair.fromSecret(stellarSecretKey);
  if (session?.owner === owner.publicKey()) return session.ready;
  const previous = session;
  const ready = (async () => {
    if (previous) await (await previous.ready.catch(() => null))?.close();
    const spp = await loadSdk();
    const key = await deriveZkStorageKey(owner);
    const keyProvider = () => key.slice();

    const directory = await storageDirectory(owner.publicKey());
    let storage: Spp.Storage;
    try {
      storage = await spp.Storage.open({ keyProvider, directory, createNew: false });
    } catch (err) {
      // The SDK's way of saying this wallet has no database on this device yet.
      if (!/purpose does not match existing file/.test(String((err as Error)?.message ?? err))) throw err;
      storage = await spp.Storage.open({ keyProvider, directory, createNew: true });
    }

    const client = await spp.Client.new({
      rpcUrl,
      // Used only when the RPC no longer holds the pools' early ledgers.
      bootnodeUrl: historyUrl,
      storage,
      contractConfig: deployment,
      circuitsBaseUrl: new URL(`${SDK_BASE}dist/circuits/`, window.location.origin).href,
      circuitLock,
    });
    await client.backgroundSync();

    // Deriving the privacy keys needs the owner's own signature, so it runs on
    // an owner-only account; the keys are then stored for the payer account.
    const { networkPassphrase } = deployment;
    const ownerOnly = await client.account({ networkPassphrase, userAddress: owner.publicKey() }, createOwnerSigner(owner));
    let published: Spp.UserPublicKeys;
    try {
      published = await ownerOnly.derivePrivacyKeys();
    } finally {
      ownerOnly.free();
    }

    // Publish the public keys, signed by the wallet, so others can pay this user.
    // Not fatal: paying and receiving by keys still works without it.
    const keysPublished = await publish(signZkKeys(owner, published.notePublicKey, published.encryptionPublicKey)).then(
      () => true,
      (err) => {
        console.warn("Could not publish private-payment keys:", err);
        return false;
      }
    );

    const payerAddress = await payer.address();
    const account = await client.account(
      { networkPassphrase, userAddress: owner.publicKey(), signerAddress: payerAddress },
      createZkSigner({ owner, payerAddress, signWithPayer: payer.sign })
    );

    const pools = new Map<PoolAsset, Promise<Spp.PrivatePool>>();
    return {
      owner: owner.publicKey(),
      account,
      keysPublished,
      sync: () => client.sync(),
      pool(asset: PoolAsset) {
        let pool = pools.get(asset);
        if (!pool) {
          pool = account.pool({ poolContract: POOLS[asset] });
          pools.set(asset, pool);
        }
        return pool;
      },
      async poolSignedBy(asset: PoolAsset, signer: Payer) {
        const signerAddress = await signer.address();
        const other = await client.account(
          { networkPassphrase, userAddress: owner.publicKey(), signerAddress },
          createZkSigner({ owner, payerAddress: signerAddress, signWithPayer: signer.sign })
        );
        try {
          return { pool: await other.pool({ poolContract: POOLS[asset] }), free: () => other.free() };
        } catch (err) {
          other.free();
          throw err;
        }
      },
      async close() {
        client.stopBackgroundSync();
        account.free();
        client.dispose();
        await storage.close();
        key.fill(0);
      },
    };
  })();
  session = { owner: owner.publicKey(), ready };
  ready.catch(() => {
    if (session?.ready === ready) session = null;
  });
  return ready;
}

export class RecipientKeysError extends Error {}

/**
 * A Starlit user's private-payment keys, checked against their wallet's
 * signature here in the app: a server that swapped them would be caught.
 */
export async function recipientKeys(username: string, lookup = lookupZkKeys) {
  let keys;
  try {
    ({ keys } = await lookup(username));
  } catch (err) {
    if (err instanceof BackendError && err.status === 404) {
      throw new RecipientKeysError(
        /yet/.test(err.message)
          ? `@${username} can't receive private payments yet. They'll be able to once they next open Starlit Pay.`
          : `No Starlit user named @${username}.`
      );
    }
    throw err;
  }
  if (!zkKeysSignedBy(keys.stellarAddress, keys)) {
    throw new RecipientKeysError(`Couldn't verify @${keys.username}'s private keys, so nothing was sent.`);
  }
  return { username: keys.username, noteKey: keys.noteKey, encryptionKey: keys.encryptionKey };
}

/** Closes the session (on lock or sign-out), so decrypted notes leave memory. */
export async function closePrivateSession() {
  const current = session;
  session = null;
  await (await current?.ready.catch(() => null))?.close();
}
