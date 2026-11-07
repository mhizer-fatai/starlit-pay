import { Router } from "express";
import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc, supabase, NETWORK_PASSPHRASE } from "../../config.js";
import { asyncHandler, HttpError } from "../../http/errors.js";
import { logger } from "../../http/logger.js";
import { TOKEN_CONTRACTS } from "../../tokens.js";
import { ZK_POOLS } from "../../zk_pools.js";
import { createStatsService } from "./service.js";

// Each pool transaction creates exactly two notes and verifies one proof:
// count the notes in the history archive (new_commitment_event).
const COMMITMENT_TOPIC = StellarSdk.nativeToScVal("new_commitment_event", { type: "symbol" }).toXDR("base64");

async function countNotes() {
  const { count, error } = await supabase.from("zk_events").select("*", { count: "exact", head: true }).eq("payload->topic->>0", COMMITMENT_TOPIC);
  if (error) throw error;
  return { notes: count ?? 0, transactions: Math.floor((count ?? 0) / 2) };
}

/** What the private pools hold, read by simulating each token's balance() call. */
async function readPoolBalances() {
  // Simulation needs a source account but never submits: any valid address works.
  const source = new StellarSdk.Account(StellarSdk.Keypair.random().publicKey(), "0");
  const balance = async (token, pool) => {
    const tx = new StellarSdk.TransactionBuilder(source, { fee: "100", networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(new StellarSdk.Contract(token).call("balance", StellarSdk.Address.fromString(pool).toScVal()))
      .setTimeout(30)
      .build();
    const sim = await rpc.simulateTransaction(tx);
    if (!sim.result?.retval) throw new Error(`balance() failed for ${token}`);
    return Number(StellarSdk.scValToNative(sim.result.retval)) / 10_000_000;
  };
  const [xlm, usdc] = await Promise.all([balance(TOKEN_CONTRACTS.XLM, ZK_POOLS.XLM), balance(TOKEN_CONTRACTS.USDC, ZK_POOLS.USDC)]);
  return { xlm, usdc };
}

const service = createStatsService({ countNotes, readPoolBalances, logger });
const router = Router();
router.get(
  "/api/stats",
  asyncHandler(async (req, res) => {
    try {
      res.status(200).json(await service.get());
    } catch (err) {
      logger.error("Stats failed:", err);
      throw new HttpError(500, "Failed to fetch stats");
    }
  })
);
export const statsRouter = router;
