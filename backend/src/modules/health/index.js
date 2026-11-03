import crypto from "node:crypto";
import { Router } from "express";
import { dbPoolConfig, rpc, supabase } from "../../config.js";
import { asyncHandler } from "../../http/errors.js";
import { logger } from "../../http/logger.js";
import { metrics } from "../../http/metrics.js";
import { getRelayerMonitorStatus } from "../../relayer_monitor.js";
import { createDaemonState } from "../../daemon_state.js";
import { createHealthService } from "./service.js";

const backgroundJobs = process.env.BACKGROUND_JOBS !== "off";
const state = createDaemonState(supabase);
const INDEXER_LAG_WARN_LEDGERS = 100; // about 8 minutes
const STALLED_MS = 10 * 60 * 1000;

const count = async (query) => {
  const { count: n, error } = await query;
  if (error) throw error;
  return n ?? 0;
};

const health = createHealthService({
  checks: {
    async database() {
      await count(supabase.from("users").select("*", { count: "exact", head: true }));
      return {};
    },

    async rpc() {
      const { status, latestLedger } = await rpc.getHealth();
      if (status !== "healthy") throw new Error("unhealthy");
      return { latestLedger };
    },

    // The relayer pays every private payment's fee.
    async relayer() {
      const monitor = getRelayerMonitorStatus();
      if (["CRITICAL", "ERROR", "NOT_INITIALIZED"].includes(monitor.status)) throw new Error(monitor.status);
      return { status: monitor.status === "HEALTHY" ? "ok" : "warn", balanceXlm: monitor.currentBalanceXlm };
    },

    async gateway() {
      if (!backgroundJobs) return { status: "off" };
      const deposits = () => supabase.from("gateway_deposits").select("*", { count: "exact", head: true });
      const [needsReview, stalled] = await Promise.all([
        count(deposits().eq("status", "needs_review")),
        count(deposits().in("status", ["processing", "submitted", "failed"]).lt("updated_at", new Date(Date.now() - STALLED_MS).toISOString())),
      ]);
      return { status: needsReview || stalled ? "warn" : "ok", needsReview, stalled };
    },

    async indexer() {
      if (!backgroundJobs) return { status: "off" };
      const [saved, latest] = await Promise.all([state.get("indexer"), rpc.getLatestLedger()]);
      const lagLedgers = saved?.nextLedger ? Math.max(0, latest.sequence - saved.nextLedger) : null;
      return { status: lagLedgers !== null && lagLedgers <= INDEXER_LAG_WARN_LEDGERS ? "ok" : "warn", lagLedgers };
    },
  },
});

// Metrics are off unless METRICS_TOKEN is set: per-route counts on a privacy
// app would let anyone line up withdrawals with on-chain activity.
function metricsAllowed(req) {
  const token = process.env.METRICS_TOKEN;
  if (!token) return false;
  const given = Buffer.from(req.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const expected = Buffer.from(token);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const router = Router();
router.get(
  "/api/health",
  asyncHandler(async (req, res) => {
    const report = await health.report();
    res.status(report.status === "down" ? 503 : 200).json(report);
  })
);
// Database only, with its connection settings.
router.get("/api/health/db", async (req, res) => {
  const startedAt = Date.now();
  try {
    await count(supabase.from("users").select("*", { count: "exact", head: true }));
    res.json({ status: "connected", latencyMs: Date.now() - startedAt, pool: dbPoolConfig, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error("Database health check failed:", err);
    res.status(500).json({ status: "error", error: "Database unavailable.", latencyMs: Date.now() - startedAt, pool: dbPoolConfig });
  }
});
router.get("/api/metrics", (req, res) => {
  if (!metricsAllowed(req)) return res.status(404).json({ error: "Not found.", code: "not_found" });
  res.type("text/plain; version=0.0.4").send(metrics.render());
});
export const healthRouter = router;
