import fs from "fs";
import path from "path";
import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc, horizon, supabase } from "./config.js";

// Asynchronous Background Event Indexer
const STATE_FILE = path.join(process.cwd(), "indexer_state.json");
let lastIndexedLedger = 3300000;

try {
  if (fs.existsSync(STATE_FILE)) {
    const stateData = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    if (stateData && stateData.lastIndexedLedger) {
      lastIndexedLedger = stateData.lastIndexedLedger;
    }
  }
} catch (err) {
  console.error("Failed to read indexer state:", err.message);
}

let isIndexing = false;
async function runIndexer() {
  if (isIndexing) return;
  isIndexing = true;

  try {
    const activeContractId = process.env.SHIELDED_POOL_CONTRACT_ID;
    if (!activeContractId) {
      isIndexing = false;
      return;
    }

    const latestLedgerRes = await horizon.ledgers().limit(1).order("desc").call();
    const latestLedger = latestLedgerRes.records[0].sequence;

    if (lastIndexedLedger >= latestLedger) {
      isIndexing = false;
      return;
    }

    let currentStart = lastIndexedLedger;
    const chunkSize = 10000;
    let foundEvents = [];

    while (currentStart <= latestLedger) {
      const currentEnd = Math.min(latestLedger, currentStart + chunkSize);
      const filter = {
        startLedger: currentStart,
        endLedger: currentEnd + 1,
        filters: [
          {
            type: "contract",
            contractIds: [activeContractId]
          }
        ],
        limit: 1000
      };

      try {
        const res = await rpc.getEvents(filter);
        if (res.events && res.events.length > 0) {
          foundEvents.push(...res.events);
        }
        currentStart = currentEnd + 1;
      } catch (err) {
        console.error(`Indexer range query failed [${currentStart}, ${currentEnd}]:`, err.message);
        break;
      }
    }

    for (const e of foundEvents) {
      try {
        const topic0 = StellarSdk.scValToNative(e.topic[0]).toString();
        if (topic0 === "deposit") {
          const root = Buffer.from(StellarSdk.scValToNative(e.topic[1])).toString("hex");
          const valArray = StellarSdk.scValToNative(e.value);
          const commitment = Buffer.from(valArray[0]).toString("hex");

          const { error } = await supabase
            .from("shielded_notes")
            .update({ root, ledger: e.ledger })
            .eq("commitment", commitment);

          if (error) {
            console.error(`Indexer DB update failed for deposit commitment ${commitment}:`, error.message);
          } else {
            console.log(`Indexer successfully verified deposit commitment ${commitment} at root ${root} (ledger ${e.ledger})`);
          }
        } else if (topic0 === "transfer") {
          const root = Buffer.from(StellarSdk.scValToNative(e.topic[1])).toString("hex");
          const valArray = StellarSdk.scValToNative(e.value);
          const commitment1 = Buffer.from(valArray[2]).toString("hex");
          const commitment2 = Buffer.from(valArray[4]).toString("hex");

          const { error: error1 } = await supabase
            .from("shielded_notes")
            .update({ root, ledger: e.ledger })
            .eq("commitment", commitment1);

          const { error: error2 } = await supabase
            .from("shielded_notes")
            .update({ root, ledger: e.ledger })
            .eq("commitment", commitment2);

          if (error1) console.error(`Indexer DB update failed for transfer commitment 1 ${commitment1}:`, error1.message);
          if (error2) console.error(`Indexer DB update failed for transfer commitment 2 ${commitment2}:`, error2.message);

          if (!error1 && !error2) {
            console.log(`Indexer successfully verified transfer commitments [${commitment1}, ${commitment2}] at root ${root} (ledger ${e.ledger})`);
          }
        } else if (topic0 === "withdraw") {
          const root = Buffer.from(StellarSdk.scValToNative(e.topic[1])).toString("hex");
          const valArray = StellarSdk.scValToNative(e.value);
          const changeCommitment = Buffer.from(valArray[2]).toString("hex");

          const { error } = await supabase
            .from("shielded_notes")
            .update({ root, ledger: e.ledger })
            .eq("commitment", changeCommitment);

          if (error) {
            console.error(`Indexer DB update failed for withdraw change commitment ${changeCommitment}:`, error.message);
          } else {
            console.log(`Indexer successfully verified withdraw change commitment ${changeCommitment} at root ${root} (ledger ${e.ledger})`);
          }
        }
      } catch (parseErr) {
        console.error("Indexer failed to parse event:", parseErr.message);
      }
    }

    lastIndexedLedger = Math.max(1, latestLedger - 3);
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastIndexedLedger }), "utf-8");

  } catch (err) {
    console.error("Indexer main loop failed:", err.message);
  } finally {
    isIndexing = false;
  }
}

// Starts the polling indexer interval automatically when this script is imported
export function startIndexer() {
  console.log("Soroban Event Indexer started.");
  setInterval(runIndexer, 5000);
}
