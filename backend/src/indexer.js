import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc, supabase } from "./config.js";
import { logger } from "./http/logger.js";
import { createDaemonState } from "./daemon_state.js";
import { createEventScanner } from "./modules/indexer/scanner.js";

// Background event indexer: records the Merkle root each pool deposit,
// transfer or withdrawal produced on the notes it created.

const POLL_INTERVAL_MS = 15_000;
const hex = (value) => Buffer.from(value).toString("hex");

async function setRoot(commitment, root, ledger) {
  const { error } = await supabase.from("shielded_notes").update({ root, ledger }).eq("commitment", commitment);
  // Thrown so the scan stops here and retries, instead of losing the root.
  if (error) throw new Error(`Indexer DB update failed for ${commitment}: ${error.message}`);
}

export async function applyPoolEvent(e) {
  let kind, root, values;
  try {
    kind = StellarSdk.scValToNative(e.topic[0]).toString();
    if (!["deposit", "transfer", "withdraw"].includes(kind)) return;
    root = hex(StellarSdk.scValToNative(e.topic[1]));
    values = StellarSdk.scValToNative(e.value);
  } catch (err) {
    logger.error("Indexer failed to parse event:", err);
    return;
  }

  const commitments =
    kind === "deposit" ? [hex(values[0])] : kind === "transfer" ? [hex(values[2]), hex(values[4])] : [hex(values[2])];
  for (const commitment of commitments) await setRoot(commitment, root, e.ledger);
  logger.info(`Indexer recorded ${kind} at root ${root} (ledger ${e.ledger})`);
}

export function startIndexer() {
  const contractId = process.env.SHIELDED_POOL_CONTRACT_ID;
  if (!contractId) {
    logger.info("Indexer skipped (SHIELDED_POOL_CONTRACT_ID not set).");
    return;
  }
  logger.info("Soroban event indexer started.");
  const scan = createEventScanner({ rpc, contractId, state: createDaemonState(supabase), applyEvent: applyPoolEvent, logger });
  setInterval(scan, POLL_INTERVAL_MS);
}
