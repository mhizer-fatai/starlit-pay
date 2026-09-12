import * as StellarSdk from "@stellar/stellar-sdk";
import rateLimit from "express-rate-limit";
import { app, rpc, horizon, relayerKeypair, NETWORK_PASSPHRASE } from "./config.js";
import { isAddressBlocked } from "./asp_service.js";

// Minimum gas threshold before alerting (in XLM)
const MIN_RELAYER_XLM_BALANCE = 10;

// Checks relayer XLM balance and alerts if low
export async function checkRelayerBalance() {
  if (!relayerKeypair) return null;
  try {
    const account = await horizon.loadAccount(relayerKeypair.publicKey());
    const nativeBalance = account.balances.find((b) => b.asset_type === "native");
    const balance = nativeBalance ? parseFloat(nativeBalance.balance) : 0;

    if (balance < MIN_RELAYER_XLM_BALANCE) {
      console.warn(
        `[RELAYER GAS ALERT] Relayer account ${relayerKeypair.publicKey()} balance is LOW: ${balance} XLM. Please top up.`
      );
    }
    return balance;
  } catch (err) {
    console.error("Failed to check relayer balance:", err.message);
    return null;
  }
}

// Rate Limiter for Relayer Gas Endpoints (Max 20 requests per 15 minutes per IP)
const relayerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many transaction submissions. Please wait before attempting another relayer transaction." }
});

// Helper to validate Stellar/Soroban Contract ID format (starts with C, 56 chars)
function isValidContractId(id) {
  return typeof id === "string" && /^C[A-Z2-7]{55}$/.test(id);
}

// Submits client claims/withdrawals to Soroban Shielded Pool contract using relayer gas
app.post("/api/relayer/submit", relayerLimiter, async (req, res) => {
  const { proof, nullifier, recipient, token, amount, root } = req.body;
  const activeContractId = process.env.SHIELDED_POOL_CONTRACT_ID;

  if (!isValidContractId(activeContractId)) {
    return res.status(500).json({ error: "Invalid active contract configuration on server." });
  }

  if (!proof || !nullifier || !recipient || !token || !amount || !root) {
    return res.status(400).json({ error: "Missing parameters for transaction submission." });
  }

  if (await isAddressBlocked(recipient)) {
    return res.status(403).json({ error: "Recipient address is restricted under compliance policy." });
  }

  if (!relayerKeypair) {
    return res.status(500).json({ error: "Relayer not initialized on the server." });
  }

  try {
    console.log(`Relayer submitting claim of ${amount} to ${recipient} for token ${token}...`);

    const account = await rpc.getAccount(relayerKeypair.publicKey());
    const contract = new StellarSdk.Contract(activeContractId);

    const proofVal = StellarSdk.nativeToScVal(Buffer.from(proof, "hex"), { type: "bytes" });
    const nullifierVal = StellarSdk.nativeToScVal(Buffer.from(nullifier, "hex"), { type: "bytes" });
    const recipientVal = StellarSdk.Address.fromString(recipient).toScVal();
    const tokenVal = StellarSdk.Address.fromString(token).toScVal();
    const amountVal = StellarSdk.nativeToScVal(BigInt(Math.round(amount * 10000000)), { type: "i128" });
    const rootVal = StellarSdk.nativeToScVal(Buffer.from(root, "hex"), { type: "bytes" });

    let tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("claim", proofVal, nullifierVal, recipientVal, tokenVal, amountVal, rootVal))
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

    let txResult = await rpc.getTransaction(response.hash);
    let attempts = 0;
    while ((txResult.status === "NOT_FOUND" || txResult.status === "PENDING") && attempts < 30) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      txResult = await rpc.getTransaction(response.hash);
      attempts++;
    }

    if (txResult.status === "SUCCESS") {
      res.status(200).json({ success: true, hash: response.hash, ledger: txResult.ledger });
    } else {
      throw new Error(`Transaction finished with status: ${txResult.status}`);
    }
  } catch (error) {
    console.error("Relayer execution error:", error.message);
    res.status(500).json({ error: error.message || "Failed to submit transaction via Relayer." });
  }
});

// Submits client private pool-to-pool transfer to Soroban Shielded Pool contract using relayer gas
app.post("/api/relayer/transfer", relayerLimiter, async (req, res) => {
  const {
    proof,
    nullifier_1,
    nullifier_2,
    output_commitment_1,
    encrypted_note_1,
    output_commitment_2,
    encrypted_note_2,
    root
  } = req.body;
  const activeContractId = process.env.SHIELDED_POOL_CONTRACT_ID;

  if (!isValidContractId(activeContractId)) {
    return res.status(500).json({ error: "Invalid active contract configuration on server." });
  }

  if (
    !proof ||
    !nullifier_1 ||
    !nullifier_2 ||
    !output_commitment_1 ||
    !encrypted_note_1 ||
    !output_commitment_2 ||
    !encrypted_note_2 ||
    !root
  ) {
    return res.status(400).json({ error: "Missing parameters for transfer transaction submission." });
  }

  if (!relayerKeypair) {
    return res.status(500).json({ error: "Relayer not initialized on the server." });
  }

  try {
    console.log(`Relayer submitting transfer...`);

    const account = await rpc.getAccount(relayerKeypair.publicKey());
    const contract = new StellarSdk.Contract(activeContractId);

    const proofVal = StellarSdk.nativeToScVal(Buffer.from(proof, "hex"), { type: "bytes" });
    const nullifier1Val = StellarSdk.nativeToScVal(Buffer.from(nullifier_1, "hex"), { type: "bytes" });
    const nullifier2Val = StellarSdk.nativeToScVal(Buffer.from(nullifier_2, "hex"), { type: "bytes" });
    const outCommitment1Val = StellarSdk.nativeToScVal(Buffer.from(output_commitment_1, "hex"), { type: "bytes" });
    const encryptedNote1Val = StellarSdk.nativeToScVal(Buffer.from(encrypted_note_1, "hex"), { type: "bytes" });
    const outCommitment2Val = StellarSdk.nativeToScVal(Buffer.from(output_commitment_2, "hex"), { type: "bytes" });
    const encryptedNote2Val = StellarSdk.nativeToScVal(Buffer.from(encrypted_note_2, "hex"), { type: "bytes" });
    const rootVal = StellarSdk.nativeToScVal(Buffer.from(root, "hex"), { type: "bytes" });

    let tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "transfer",
          proofVal,
          nullifier1Val,
          nullifier2Val,
          outCommitment1Val,
          encryptedNote1Val,
          outCommitment2Val,
          encryptedNote2Val,
          rootVal
        )
      )
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

    let txResult = await rpc.getTransaction(response.hash);
    let attempts = 0;
    while ((txResult.status === "NOT_FOUND" || txResult.status === "PENDING") && attempts < 30) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      txResult = await rpc.getTransaction(response.hash);
      attempts++;
    }

    if (txResult.status === "SUCCESS") {
      res.status(200).json({ success: true, hash: response.hash, ledger: txResult.ledger });
    } else {
      throw new Error(`Transaction finished with status: ${txResult.status}`);
    }
  } catch (error) {
    console.error("Relayer transfer execution error:", error.message);
    res.status(500).json({ error: error.message || "Failed to submit transfer transaction via Relayer." });
  }
});

// Submits client private pool-to-public withdrawal with change to Soroban Shielded Pool contract using relayer gas
app.post("/api/relayer/withdraw", relayerLimiter, async (req, res) => {
  const {
    proof,
    nullifier_1,
    nullifier_2,
    recipient,
    token,
    amount,
    root,
    change_commitment,
    encrypted_change_note
  } = req.body;
  const activeContractId = process.env.SHIELDED_POOL_CONTRACT_ID;

  if (!isValidContractId(activeContractId)) {
    return res.status(500).json({ error: "Invalid active contract configuration on server." });
  }

  if (
    !proof ||
    !nullifier_1 ||
    !nullifier_2 ||
    !recipient ||
    !token ||
    !amount ||
    !root ||
    !change_commitment ||
    !encrypted_change_note
  ) {
    return res.status(400).json({ error: "Missing parameters for withdraw transaction submission." });
  }

  if (await isAddressBlocked(recipient)) {
    return res.status(403).json({ error: "Recipient address is restricted under compliance policy." });
  }

  if (!relayerKeypair) {
    return res.status(500).json({ error: "Relayer not initialized on the server." });
  }

  try {
    console.log(`Relayer submitting withdrawal with change...`);

    const account = await rpc.getAccount(relayerKeypair.publicKey());
    const contract = new StellarSdk.Contract(activeContractId);

    const proofVal = StellarSdk.nativeToScVal(Buffer.from(proof, "hex"), { type: "bytes" });
    const nullifier1Val = StellarSdk.nativeToScVal(Buffer.from(nullifier_1, "hex"), { type: "bytes" });
    const nullifier2Val = StellarSdk.nativeToScVal(Buffer.from(nullifier_2, "hex"), { type: "bytes" });
    const recipientVal = StellarSdk.Address.fromString(recipient).toScVal();
    const tokenVal = StellarSdk.Address.fromString(token).toScVal();
    const amountVal = StellarSdk.nativeToScVal(BigInt(Math.round(amount * 10000000)), { type: "i128" });
    const rootVal = StellarSdk.nativeToScVal(Buffer.from(root, "hex"), { type: "bytes" });
    const changeCommitmentVal = StellarSdk.nativeToScVal(Buffer.from(change_commitment, "hex"), { type: "bytes" });
    const encryptedChangeNoteVal = StellarSdk.nativeToScVal(Buffer.from(encrypted_change_note, "hex"), { type: "bytes" });

    let tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "withdraw",
          proofVal,
          nullifier1Val,
          nullifier2Val,
          recipientVal,
          tokenVal,
          amountVal,
          rootVal,
          changeCommitmentVal,
          encryptedChangeNoteVal
        )
      )
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

    let txResult = await rpc.getTransaction(response.hash);
    let attempts = 0;
    while ((txResult.status === "NOT_FOUND" || txResult.status === "PENDING") && attempts < 30) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      txResult = await rpc.getTransaction(response.hash);
      attempts++;
    }

    if (txResult.status === "SUCCESS") {
      checkRelayerBalance().catch(() => {});
      res.status(200).json({ success: true, hash: response.hash, ledger: txResult.ledger });
    } else {
      throw new Error(`Transaction finished with status: ${txResult.status}`);
    }
  } catch (error) {
    console.error("Relayer withdraw execution error:", error.message);
    res.status(500).json({ error: error.message || "Failed to submit withdraw transaction via Relayer." });
  }
});

// Endpoint to monitor relayer health and gas balance
app.get("/api/relayer/health", async (req, res) => {
  if (!relayerKeypair) {
    return res.status(503).json({ status: "unavailable", error: "Relayer keypair not configured." });
  }

  const balance = await checkRelayerBalance();
  res.json({
    status: "ok",
    address: relayerKeypair.publicKey(),
    balanceXlm: balance,
    isLowGas: balance !== null && balance < MIN_RELAYER_XLM_BALANCE,
  });
});


