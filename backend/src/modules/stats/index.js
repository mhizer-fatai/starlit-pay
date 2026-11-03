import { Router } from "express";
import * as StellarSdk from "@stellar/stellar-sdk";
import { app, rpc, supabase, NETWORK_PASSPHRASE } from "../../config.js";
import { asyncHandler, HttpError } from "../../http/errors.js";
import { logger } from "../../http/logger.js";
import { TOKEN_CONTRACTS } from "../../tokens.js";
import { createStatsService } from "./service.js";

async function countNotes() {
  const count = async (spentOnly) => {
    let query = supabase.from("shielded_notes").select("*", { count: "exact", head: true });
    if (spentOnly) query = query.eq("status", "spent");
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  };
  const [total, spent] = await Promise.all([count(false), count(true)]);
  return { total, spent };
}

/** Token balances held by the pool, read by simulating each token's balance() call. */
async function readPoolBalances() {
  const pool = process.env.SHIELDED_POOL_CONTRACT_ID;
  if (!pool) throw new Error("SHIELDED_POOL_CONTRACT_ID is not set");
  // Simulation needs a source account but never submits: any valid address works.
  const source = new StellarSdk.Account(StellarSdk.Keypair.random().publicKey(), "0");
  const balance = async (token) => {
    const tx = new StellarSdk.TransactionBuilder(source, { fee: "100", networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(new StellarSdk.Contract(token).call("balance", StellarSdk.Address.fromString(pool).toScVal()))
      .setTimeout(30)
      .build();
    const sim = await rpc.simulateTransaction(tx);
    if (!sim.result?.retval) throw new Error(`balance() failed for ${token}`);
    return Number(StellarSdk.scValToNative(sim.result.retval)) / 10_000_000;
  };
  const [xlm, usdc] = await Promise.all([balance(TOKEN_CONTRACTS.XLM), balance(TOKEN_CONTRACTS.USDC)]);
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
app.use(router);
