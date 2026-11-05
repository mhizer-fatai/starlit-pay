import { Router } from "express";
import { RPC_URL, supabase } from "../../config.js";
import { createDaemonState } from "../../daemon_state.js";
import { asyncHandler } from "../../http/errors.js";
import { logger } from "../../http/logger.js";
import { createZkHistoryIngest, createRpcCall, ZK_HISTORY_STATE } from "./ingest.js";
import { createZkHistoryRepository } from "./repository.js";
import { createZkHistoryRpc } from "./rpc.js";

// History of the private pools (real ZK) for the SPP SDK: the contracts its
// indexer reads (enabled pools, allowlist, key registry), from the first
// pool's deployment ledger. Testnet values; ZK_HISTORY_CONTRACTS overrides.
const DEFAULT_CONTRACTS = [
  "CBPXO3XY6DVA4K6MU3K2JFYUOLUBFOMP2ACFFNVUP5LQZUZXFSTABPUX", // XLM pool
  "CBRXBWOEVQRNP7ZLGUTKG5UQBEFSOLLVHV4UEEVBKRPECB763YGHANLY", // USDC pool
  "CAMJX22KMXJXXR6IAONMJKIFJWE2LZOKI5I4VXXNZVHDK4HLPW7UFBTF", // allowlist
  "CCTWXJO4ZNS6KZHGRUVCNV5HQJAHQMXRXMF7UT5TJ7CXCT7YSYCJN3MU", // key registry
];
const contracts = (process.env.ZK_HISTORY_CONTRACTS ?? DEFAULT_CONTRACTS.join(",")).split(",").map((id) => id.trim()).filter(Boolean);
const START_LEDGER = Number(process.env.ZK_HISTORY_START_LEDGER || 5561537);
// Hand off to Stellar RPC 5 days behind the tip (5-second ledgers), like the SPP bootnode.
const CUTOFF_LEDGERS = Number(process.env.ZK_HISTORY_CUTOFF_LEDGERS || (5 * 24 * 60 * 60) / 5);
const POLL_INTERVAL_MS = 15_000;

const rpcCall = createRpcCall(RPC_URL);
const state = createDaemonState(supabase);
const repository = createZkHistoryRepository(supabase);

const handle = createZkHistoryRpc({
  repository,
  contracts,
  minDeploymentLedger: START_LEDGER,
  state: async () => (await state.get(ZK_HISTORY_STATE)) ?? {},
  cutoffLedgers: CUTOFF_LEDGERS,
  upstreamLatestLedger: () => rpcCall("getLatestLedger", {}),
});

// Public chain data, no sign-in: the SDK calls it like any Stellar RPC.
export const zkHistoryRouter = Router();
zkHistoryRouter.post(
  "/api/zk/history",
  asyncHandler(async (req, res) => {
    res.status(200).json(await handle(req.body, logger));
  })
);

export function startZkHistory() {
  logger.info("ZK history archive started.");
  const ingest = createZkHistoryIngest({ rpcCall, repository, state, contracts, startLedger: START_LEDGER, logger });
  ingest();
  setInterval(ingest, POLL_INTERVAL_MS);
}
