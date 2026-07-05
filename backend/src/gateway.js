import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc, horizon, supabase, gatewayKeypair, NETWORK_PASSPHRASE } from "./config.js";
import { calculateCommitment, encryptNoteForUser } from "./crypto.js";

const GATEWAY_STATE_FILE = path.join(process.cwd(), "gateway_state.json");
let lastProcessedTxToken = "0";

try {
  if (fs.existsSync(GATEWAY_STATE_FILE)) {
    const gatewayState = JSON.parse(fs.readFileSync(GATEWAY_STATE_FILE, "utf-8"));
    if (gatewayState && gatewayState.lastProcessedTxToken) {
      lastProcessedTxToken = gatewayState.lastProcessedTxToken;
    }
  }
} catch (err) {
  console.error("Failed to read gateway indexer state:", err.message);
}

// Submits a shielded pool deposit from the gateway coordinator address using the gateway's key and sequence counter
async function submitGatewayDeposit(gatewayKeypair, contractId, token, amount, commitmentHex, encryptedNoteHex) {
  const contract = new StellarSdk.Contract(contractId);
  const account = await rpc.getAccount(gatewayKeypair.publicKey());

  const depositorVal = StellarSdk.Address.fromString(gatewayKeypair.publicKey()).toScVal();
  const tokenVal = StellarSdk.Address.fromString(token).toScVal();
  const amountVal = StellarSdk.nativeToScVal(BigInt(Math.round(amount * 10000000)), { type: "i128" });
  const commitmentVal = StellarSdk.nativeToScVal(Buffer.from(commitmentHex, "hex"), { type: "bytes" });
  const noteVal = StellarSdk.nativeToScVal(Buffer.from(encryptedNoteHex, "hex"), { type: "bytes" });

  let tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("deposit", depositorVal, tokenVal, amountVal, commitmentVal, noteVal))
    .setTimeout(180)
    .build();

  const simulation = await rpc.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Simulation failed: ${simulation.error}`);
  }

  tx = StellarSdk.rpc.assembleTransaction(tx, simulation).build();
  tx.sign(gatewayKeypair);

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
    return response.hash;
  } else {
    throw new Error(`Transaction finished with status: ${txResult.status}`);
  }
}

let isGatewayRunning = false;
async function runGatewayDaemon() {
  if (isGatewayRunning) return;
  if (!gatewayKeypair) return;
  isGatewayRunning = true;

  try {
    const gatewayAddress = gatewayKeypair.publicKey();
    const activeContractId = process.env.SHIELDED_POOL_CONTRACT_ID;
    if (!activeContractId) {
      isGatewayRunning = false;
      return;
    }

    const txsQuery = horizon.transactions().forAccount(gatewayAddress).order("asc").limit(20);
    if (lastProcessedTxToken !== "0") {
      txsQuery.cursor(lastProcessedTxToken);
    }
    
    let txsRes;
    try {
      console.log(`Gateway querying transactions for address ${gatewayAddress} starting at cursor ${lastProcessedTxToken}...`);
      txsRes = await txsQuery.call();
      console.log(`Gateway query complete. Found ${txsRes.records.length} transaction records.`);
    } catch (horizonErr) {
      console.error("Gateway Horizon query failed:", horizonErr.message || horizonErr);
      isGatewayRunning = false;
      return;
    }

    for (const txRecord of txsRes.records) {
      try {
        if (txRecord.memo_type !== "id" && txRecord.memo_type !== "text") {
          lastProcessedTxToken = txRecord.paging_token;
          continue;
        }
        
        const memoId = parseInt(txRecord.memo);
        if (isNaN(memoId)) {
          lastProcessedTxToken = txRecord.paging_token;
          continue;
        }

        const { data: user, error: userError } = await supabase
          .from("users")
          .select("id, username, public_encryption_key")
          .eq("deposit_memo", memoId)
          .maybeSingle();

        if (userError) {
          console.error(`Gateway DB error lookup for memo ${memoId}:`, userError.message);
          continue;
        }

        if (!user) {
          console.log(`Gateway received transaction ${txRecord.hash} with memo ${memoId} but no user was found.`);
          lastProcessedTxToken = txRecord.paging_token;
          continue;
        }

        const tx = new StellarSdk.Transaction(txRecord.envelope_xdr, NETWORK_PASSPHRASE);

        for (const op of tx.operations) {
          if (op.type === "payment" && op.destination === gatewayAddress) {
            const amount = parseFloat(op.amount);
            if (amount <= 0.0001) continue;

            const isNative = op.asset.isNative();
            const tokenAddress = isNative 
              ? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
              : "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
            
            const assetName = isNative ? "XLM" : "USDC";

            console.log(`Gateway processing incoming deposit of ${amount} ${assetName} for @${user.username} (Memo: ${memoId})`);

            // Derive noteSecret deterministically from transaction hash to prevent duplicate processing on server restarts
            const noteSecret = crypto.createHmac("sha256", gatewayKeypair.secret()).update(txRecord.hash).digest("hex");
            const commitmentHex = await calculateCommitment(amount, user.public_encryption_key, tokenAddress, noteSecret);
            const encrypted = encryptNoteForUser(amount, assetName, noteSecret, tx.source, user.public_encryption_key);
            const encryptedHex = encrypted.ephemeralPublicKey + encrypted.nonce + encrypted.ciphertext;

            // Check if this commitment has already been processed
            const { data: existingNote } = await supabase
              .from("shielded_notes")
              .select("commitment")
              .eq("commitment", commitmentHex)
              .maybeSingle();

            if (existingNote) {
              console.log(`Gateway: commitment ${commitmentHex} already processed. Skipping.`);
              continue;
            }

            const { error: insertErr } = await supabase
              .from("shielded_notes")
              .insert([{
                commitment: commitmentHex,
                token_address: tokenAddress,
                amount: amount,
                encrypted_note: encryptedHex,
                recipient_viewing_key: user.public_encryption_key,
                status: "unspent"
              }]);

            if (insertErr) {
              console.error(`Gateway duplicate prevention insert failed: ${insertErr.message}`);
              continue;
            }

            try {
              console.log(`Gateway submitting Soroban deposit of ${amount} ${assetName} with commitment ${commitmentHex}`);
              const depositTxHash = await submitGatewayDeposit(
                gatewayKeypair,
                activeContractId,
                tokenAddress,
                amount,
                commitmentHex,
                encryptedHex
              );

              console.log(`Gateway successfully shielded deposit! Contract Tx: ${depositTxHash}`);

              await supabase
                .from("shielded_notes")
                .update({
                  encrypted_note: encryptedHex,
                  status: "unspent"
                })
                .eq("commitment", commitmentHex);

            } catch (submitErr) {
              console.error(`Gateway deposit transaction submission failed:`, submitErr.message);
              await supabase.from("shielded_notes").delete().eq("commitment", commitmentHex);
            }
          }
        }

        lastProcessedTxToken = txRecord.paging_token;
        fs.writeFileSync(GATEWAY_STATE_FILE, JSON.stringify({ lastProcessedTxToken }), "utf-8");
      } catch (txErr) {
        console.error(`Gateway failed to process tx ${txRecord.hash}:`, txErr.message);
      }
    }
  } catch (err) {
    console.error("Gateway daemon error:", err.message);
  } finally {
    isGatewayRunning = false;
  }
}

// Starts the gateway polling daemon interval automatically when this script is imported
export function startGateway() {
  if (gatewayKeypair) {
    console.log(`Enterprise Deposit Gateway daemon started on address: ${gatewayKeypair.publicKey()}`);
    setInterval(runGatewayDaemon, 15000);
  } else {
    console.log("Enterprise Deposit Gateway daemon skipped (GATEWAY_SECRET_KEY not set).");
  }
}
