import fs from "fs";
import path from "path";
import * as StellarSdk from "@stellar/stellar-sdk";
import dotenv from "dotenv";

dotenv.config();

const RPC_URL = process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const rpc = new StellarSdk.rpc.Server(RPC_URL);

const adminSecret = process.env.ADMIN_SECRET_KEY;
if (!adminSecret) {
  console.error("ADMIN_SECRET_KEY is required in .env");
  process.exit(1);
}
const adminKeypair = StellarSdk.Keypair.fromSecret(adminSecret.replace(/['"]/g, "").trim());
const adminAddress = adminKeypair.publicKey();
const contractId = process.env.SHIELDED_POOL_CONTRACT_ID;

const wasmPath = path.resolve("../contracts/target/wasm32v1-none/release/starlit_shield_contracts.wasm");

async function main() {
  console.log(`=== Starlit Shielded Pool Contract In-Place Upgrade ===`);
  console.log(`Admin Account: ${adminAddress}`);
  console.log(`Target Contract Address (CA): ${contractId}`);
  console.log(`Reading WASM: ${wasmPath}`);

  if (!fs.existsSync(wasmPath)) {
    throw new Error(`WASM file not found at ${wasmPath}. Run cargo build first.`);
  }
  const wasmBytes = fs.readFileSync(wasmPath);
  console.log(`WASM size: ${wasmBytes.length} bytes`);

  // 1. Upload WASM to Stellar Testnet
  console.log(`Step 1: Uploading new contract WASM to network...`);
  const account = await rpc.getAccount(adminAddress);

  const uploadOp = StellarSdk.Operation.uploadContractWasm({ wasm: wasmBytes });

  let tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(uploadOp)
    .setTimeout(180)
    .build();

  console.log(`Simulating WASM upload transaction...`);
  const simUpload = await rpc.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simUpload)) {
    throw new Error(`WASM upload simulation failed: ${simUpload.error}`);
  }

  tx = StellarSdk.rpc.assembleTransaction(tx, simUpload).build();
  tx.sign(adminKeypair);

  console.log(`Submitting WASM upload transaction...`);
  const uploadRes = await rpc.sendTransaction(tx);
  if (uploadRes.status === "ERROR") {
    throw new Error(`WASM upload submission failed: ${uploadRes.errorResult}`);
  }

  let uploadTxResult = await rpc.getTransaction(uploadRes.hash);
  let attempts = 0;
  while ((uploadTxResult.status === "NOT_FOUND" || uploadTxResult.status === "PENDING") && attempts < 30) {
    await new Promise((r) => setTimeout(r, 1500));
    uploadTxResult = await rpc.getTransaction(uploadRes.hash);
    attempts++;
  }

  if (uploadTxResult.status !== "SUCCESS") {
    throw new Error(`WASM upload failed with status: ${uploadTxResult.status}`);
  }

  // Extract returned wasm_id from simulation/result
  const wasmHashHex = simUpload.result.retval ? StellarSdk.scValToNative(simUpload.result.retval) : null;
  console.log(`WASM upload SUCCESS! Tx Hash: ${uploadRes.hash}`);
  console.log(`New WASM Hash: ${wasmHashHex ? Buffer.from(wasmHashHex).toString("hex") : "Extracted from result"}`);

  const newWasmHashBytes = wasmHashHex ? Buffer.from(wasmHashHex) : null;
  if (!newWasmHashBytes) {
    throw new Error("Could not retrieve WASM hash from transaction.");
  }

  // 2. Invoke upgrade(new_wasm_hash) on the existing contract address
  console.log(`Step 2: Invoking upgrade(new_wasm_hash) on contract ${contractId}...`);
  const updatedAccount = await rpc.getAccount(adminAddress);
  const contract = new StellarSdk.Contract(contractId);

  const wasmHashVal = StellarSdk.nativeToScVal(newWasmHashBytes, { type: "bytes" });

  let upgradeTx = new StellarSdk.TransactionBuilder(updatedAccount, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("upgrade", wasmHashVal))
    .setTimeout(180)
    .build();

  console.log(`Simulating upgrade call...`);
  const simUpgrade = await rpc.simulateTransaction(upgradeTx);
  if (StellarSdk.rpc.Api.isSimulationError(simUpgrade)) {
    throw new Error(`Upgrade simulation failed: ${simUpgrade.error}`);
  }

  upgradeTx = StellarSdk.rpc.assembleTransaction(upgradeTx, simUpgrade).build();
  upgradeTx.sign(adminKeypair);

  console.log(`Submitting upgrade transaction...`);
  const upgradeRes = await rpc.sendTransaction(upgradeTx);
  if (upgradeRes.status === "ERROR") {
    throw new Error(`Upgrade submission failed: ${upgradeRes.errorResult}`);
  }

  let upgradeTxResult = await rpc.getTransaction(upgradeRes.hash);
  attempts = 0;
  while ((upgradeTxResult.status === "NOT_FOUND" || upgradeTxResult.status === "PENDING") && attempts < 30) {
    await new Promise((r) => setTimeout(r, 1500));
    upgradeTxResult = await rpc.getTransaction(upgradeRes.hash);
    attempts++;
  }

  if (upgradeTxResult.status === "SUCCESS") {
    console.log(`Contract SUCCESSFULLY UPGRADED!`);
    console.log(`Upgrade Tx Hash: ${upgradeRes.hash}`);
    console.log(`Contract Address remains: ${contractId}`);
    console.log(`Ledger: ${upgradeTxResult.ledger}`);
  } else {
    throw new Error(`Upgrade transaction finished with status: ${upgradeTxResult.status}`);
  }
}

main().catch((err) => {
  console.error("Upgrade error:", err);
  process.exit(1);
});
