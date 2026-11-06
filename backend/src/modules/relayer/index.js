import rateLimit from "express-rate-limit";
import { rpc, relayerKeypair, NETWORK_PASSPHRASE, supabase, GATEWAY_ADDRESS } from "../../config.js";
import { isAddressBlocked } from "../../asp_service.js";
import { authLayer } from "../../auth_layer/mount.js";
import { createPaymentApproval } from "../../payment_approval.js";
import { performRelayerGasCheck, getRelayerMonitorStatus } from "../../relayer_monitor.js";
import { waitForTransaction, withRelayerAccount } from "../../relayer_account.js";
import { logger } from "../../http/logger.js";
import { createPoolInvoker } from "./chain.js";
import { createRelayerService } from "./service.js";
import { createRelayerRouter } from "./routes.js";
import { TOKEN_CONTRACTS } from "../../tokens.js";
import { zkGatewayEnabled } from "../../zk_pools.js";
import { createMigrationCredits } from "../zk_gateway/migration.js";
import { createZkGatewayRepository } from "../zk_gateway/repository.js";

const contractId = process.env.SHIELDED_POOL_CONTRACT_ID;
const misconfigured = !/^C[A-Z2-7]{55}$/.test(contractId ?? "")
  ? "Invalid active contract configuration on server."
  : !relayerKeypair
    ? "Relayer not initialized on the server."
    : null;

// Old-pool withdrawals to the gateway: a user moving to the real-ZK pools.
const recordMigration = createMigrationCredits({
  repository: createZkGatewayRepository(supabase),
  gatewayAddress: GATEWAY_ADDRESS,
  tokens: TOKEN_CONTRACTS,
  enabled: zkGatewayEnabled,
  logger,
});

const service = createRelayerService({
  invoke: misconfigured
    ? null
    : createPoolInvoker({
        rpc,
        relayerKeypair,
        networkPassphrase: NETWORK_PASSPHRASE,
        contractId,
        queue: withRelayerAccount,
        waitFor: (hash) => waitForTransaction(rpc, hash),
      }),
  isAddressBlocked,
  misconfigured,
  onWithdrawn: async (withdrawal) => {
    performRelayerGasCheck().catch(() => {});
    await recordMigration(withdrawal);
  },
  logger,
});

// Monitor output for the public: never the raw error text.
function publicStatus() {
  const status = getRelayerMonitorStatus();
  return {
    ...status,
    lastError: status.lastError ? "Balance check failed." : null,
    recentChecks: status.recentChecks?.map(({ error, ...check }) => ({ ...check, ...(error ? { error: "Balance check failed." } : {}) })),
  };
}

const monitor = {
  publicStatus,
  async health() {
    if (!relayerKeypair) return { status: "unavailable", error: "Relayer keypair not configured." };
    const daemon = getRelayerMonitorStatus();
    const balance = daemon.currentBalanceXlm ?? (await performRelayerGasCheck()).balanceXlm;
    return {
      status: daemon.status === "ERROR" ? "degraded" : "ok",
      healthState: daemon.status,
      address: relayerKeypair.publicKey(),
      balanceXlm: balance,
      isLowGas: daemon.status === "WARNING" || daemon.status === "CRITICAL",
      thresholds: daemon.thresholds,
      uptimeSeconds: daemon.uptimeSeconds,
      lastCheckedAt: daemon.lastCheckedAt,
      checkCount: daemon.checkCount,
    };
  },
  async checkNow() {
    const result = await performRelayerGasCheck();
    return {
      message: "Relayer gas check executed successfully.",
      result: { ...result, error: result.error ? "Balance check failed." : undefined },
      daemon: publicStatus(),
    };
  },
};

export const relayerRouter = createRelayerRouter({
  service,
  monitor,
  // Spends need a signed-in user who just confirmed with passkey or PIN (see payment_approval.js).
  requirePaymentApproval: createPaymentApproval({ sessions: authLayer.sessions }),
  paymentLimiter: rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many transaction submissions. Please wait before attempting another relayer transaction." },
  }),
  checkLimiter: rateLimit({ windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, message: { error: "Too many checks. Try again shortly." } }),
});
