import { Router } from "express";
import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc, NETWORK_PASSPHRASE, supabase } from "../../config.js";
import { asyncHandler, HttpError } from "../../http/errors.js";
import { logger } from "../../http/logger.js";
import { createPoolRootService } from "./service.js";

async function isRootValid(rootHex) {
  // A read-only simulation: any source account works, nothing is submitted.
  const source = new StellarSdk.Account(StellarSdk.Keypair.random().publicKey(), "0");
  const tx = new StellarSdk.TransactionBuilder(source, { fee: StellarSdk.BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new StellarSdk.Contract(process.env.SHIELDED_POOL_CONTRACT_ID).call("is_root_valid", StellarSdk.nativeToScVal(Buffer.from(rootHex, "hex"), { type: "bytes" })))
    .setTimeout(30)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  return Boolean(sim?.result?.retval && StellarSdk.scValToNative(sim.result.retval));
}

async function recentRoots(limit) {
  const { data, error } = await supabase
    .from("shielded_notes")
    .select("root, ledger")
    .not("root", "is", null)
    .order("ledger", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => row.root);
}

const service = createPoolRootService({ recentRoots, isRootValid, configured: Boolean(process.env.SHIELDED_POOL_CONTRACT_ID) });

export const poolRouter = Router();
poolRouter.get(
  "/api/pool/root",
  asyncHandler(async (req, res) => {
    let root;
    try {
      root = await service.current();
    } catch (err) {
      logger.error("Pool root lookup failed:", err);
      throw new HttpError(500, "Could not look up the pool root.");
    }
    if (!root) throw new HttpError(503, "No valid pool root is available right now.");
    res.json({ root });
  })
);
