import rateLimit from "express-rate-limit";
import { relayerKeypair } from "../../config.js";
import { performRelayerGasCheck, getRelayerMonitorStatus } from "../../relayer_monitor.js";
import { createRelayerRouter } from "./routes.js";

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
  monitor,
  checkLimiter: rateLimit({ windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, message: { error: "Too many checks. Try again shortly." } }),
});
