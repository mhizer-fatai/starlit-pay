import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc, NETWORK_PASSPHRASE, relayerKeypair } from "./config.js";

// Keeps the shielded pool contract instance from being archived by calling its
// public bump() entry point. The contract only extends the TTL once it drops
// below its threshold, so a daily call is cheap and usually a no-op.
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // Once a day
const TTL_KEEPER_INTERVAL_MS = parseInt(process.env.TTL_KEEPER_INTERVAL_MS || DEFAULT_INTERVAL_MS, 10);

let keeperIntervalId = null;

export async function bumpPoolTtl() {
  const contractId = process.env.SHIELDED_POOL_CONTRACT_ID;
  if (!relayerKeypair || !contractId) return;

  try {
    const account = await rpc.getAccount(relayerKeypair.publicKey());
    const contract = new StellarSdk.Contract(contractId);

    let tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("bump"))
      .setTimeout(180)
      .build();

    const simulation = await rpc.simulateTransaction(tx);
    if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${simulation.error}`);
    }

    tx = StellarSdk.rpc.assembleTransaction(tx, simulation).build();
    tx.sign(relayerKeypair);

    const response = await rpc.sendTransaction(tx);
    if (response.status === "ERROR") {
      throw new Error(`Tx submission failed: ${response.errorResult}`);
    }
    console.log(`[TTL-KEEPER] Pool TTL bump submitted: ${response.hash}`);
  } catch (err) {
    console.error(`[TTL-KEEPER] Pool TTL bump failed: ${err.message}`);
  }
}

export function startTtlKeeper() {
  if (keeperIntervalId) return;
  if (!relayerKeypair || !process.env.SHIELDED_POOL_CONTRACT_ID) {
    console.log("Pool TTL keeper skipped (RELAYER_SECRET_KEY or SHIELDED_POOL_CONTRACT_ID not set).");
    return;
  }

  bumpPoolTtl();
  keeperIntervalId = setInterval(bumpPoolTtl, TTL_KEEPER_INTERVAL_MS);
  console.log(`Pool TTL keeper started (interval: ${TTL_KEEPER_INTERVAL_MS}ms).`);
}
