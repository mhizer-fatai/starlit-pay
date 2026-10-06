import { horizon, relayerKeypair } from "./config.js";

// Relayer Gas Monitoring Configuration Defaults
const DEFAULT_WARN_THRESHOLD_XLM = 50; // Warn if relayer balance drops below 50 XLM
const DEFAULT_CRITICAL_THRESHOLD_XLM = 15; // Critical alert if relayer drops below 15 XLM
const DEFAULT_INTERVAL_MS = 60000; // Check every 60 seconds (1 minute)

const WARN_THRESHOLD_XLM = parseFloat(process.env.RELAYER_WARN_THRESHOLD_XLM || DEFAULT_WARN_THRESHOLD_XLM);
const CRITICAL_THRESHOLD_XLM = parseFloat(process.env.RELAYER_CRITICAL_THRESHOLD_XLM || DEFAULT_CRITICAL_THRESHOLD_XLM);
const MONITOR_INTERVAL_MS = parseInt(process.env.RELAYER_MONITOR_INTERVAL_MS || DEFAULT_INTERVAL_MS, 10);
const ALERT_WEBHOOK_URL = process.env.RELAYER_ALERT_WEBHOOK_URL || null;

// Telemetry and Health State
let monitorIntervalId = null;
const state = {
  isRunning: false,
  startedAt: null,
  lastCheckedAt: null,
  checkCount: 0,
  consecutiveErrors: 0,
  currentBalanceXlm: null,
  status: "INITIALIZING", // INITIALIZING, HEALTHY, WARNING, CRITICAL, ERROR, NOT_INITIALIZED
  lastAlertSentAt: null,
  lastError: null,
  recentChecks: [] // Circular buffer of up to 30 recent checks
};

const MAX_HISTORY_LENGTH = 30;

// Record a check result in the circular history buffer
function recordHistory(checkRecord) {
  state.recentChecks.unshift(checkRecord);
  if (state.recentChecks.length > MAX_HISTORY_LENGTH) {
    state.recentChecks.pop();
  }
}

// Dispatches real-time alert webhook if configured
async function dispatchWebhookAlert(level, balanceXlm, address) {
  if (!ALERT_WEBHOOK_URL) return;

  // Throttle webhook alerts to max once every 15 minutes unless critical
  const now = Date.now();
  if (state.lastAlertSentAt && (now - state.lastAlertSentAt < 15 * 60 * 1000) && level !== "CRITICAL") {
    return;
  }

  try {
    const payload = {
      event: "RELAYER_GAS_ALERT",
      level,
      address,
      balanceXlm,
      thresholdXlm: level === "CRITICAL" ? CRITICAL_THRESHOLD_XLM : WARN_THRESHOLD_XLM,
      timestamp: new Date().toISOString(),
      network: process.env.STELLAR_NETWORK || "TESTNET",
      message: `[RELAYER GAS ${level}] Relayer ${address} balance is ${balanceXlm} XLM (threshold: ${level === "CRITICAL" ? CRITICAL_THRESHOLD_XLM : WARN_THRESHOLD_XLM} XLM). Top up required to prevent sponsored transaction failures.`
    };

    await fetch(ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    state.lastAlertSentAt = now;
    console.log(`[RELAYER-ALERT] Webhook alert successfully dispatched to ${ALERT_WEBHOOK_URL}`);
  } catch (err) {
    console.error(`[RELAYER-ALERT] Failed to send webhook alert: ${err.message}`);
  }
}

// Perform a single relayer balance inspection check
export async function performRelayerGasCheck() {
  if (!relayerKeypair) {
    state.status = "NOT_INITIALIZED";
    state.lastError = "Relayer keypair is not configured on the server.";
    return {
      status: state.status,
      balanceXlm: null,
      error: state.lastError
    };
  }

  const startTime = Date.now();
  const address = relayerKeypair.publicKey();
  state.checkCount += 1;
  const timestamp = new Date().toISOString();

  try {
    const account = await horizon.loadAccount(address);
    const nativeBalance = account.balances.find((b) => b.asset_type === "native");
    const balance = nativeBalance ? parseFloat(nativeBalance.balance) : 0;
    const responseTimeMs = Date.now() - startTime;

    state.currentBalanceXlm = balance;
    state.lastCheckedAt = timestamp;
    state.consecutiveErrors = 0;
    state.lastError = null;

    let checkStatus = "HEALTHY";

    if (balance < CRITICAL_THRESHOLD_XLM) {
      checkStatus = "CRITICAL";
      state.status = "CRITICAL";
      console.error(
        `[RELAYER-ALERT] [CRITICAL] [${timestamp}] Relayer gas reserve CRITICALLY LOW! Address: ${address} | Balance: ${balance} XLM | Critical Threshold: ${CRITICAL_THRESHOLD_XLM} XLM. Sponsored transactions at risk of failing.`
      );
      dispatchWebhookAlert("CRITICAL", balance, address).catch(() => {});
    } else if (balance < WARN_THRESHOLD_XLM) {
      checkStatus = "WARNING";
      state.status = "WARNING";
      console.warn(
        `[RELAYER-ALERT] [WARNING] [${timestamp}] Relayer gas reserve below warning threshold. Address: ${address} | Balance: ${balance} XLM | Warn Threshold: ${WARN_THRESHOLD_XLM} XLM. Top up recommended.`
      );
      dispatchWebhookAlert("WARNING", balance, address).catch(() => {});
    } else {
      checkStatus = "HEALTHY";
      state.status = "HEALTHY";
      console.log(
        `[RELAYER-MONITOR] [${timestamp}] Status: HEALTHY | Relayer: ${address.slice(0, 6)}...${address.slice(-4)} | Balance: ${balance.toFixed(4)} XLM | Warn: ${WARN_THRESHOLD_XLM} XLM | Critical: ${CRITICAL_THRESHOLD_XLM} XLM | Latency: ${responseTimeMs}ms | Checks: ${state.checkCount}`
      );
    }

    recordHistory({
      timestamp,
      balanceXlm: balance,
      status: checkStatus,
      responseTimeMs
    });

    return {
      status: checkStatus,
      balanceXlm: balance,
      address,
      responseTimeMs
    };
  } catch (err) {
    const responseTimeMs = Date.now() - startTime;
    state.consecutiveErrors += 1;
    state.status = "ERROR";
    state.lastError = err.message;
    state.lastCheckedAt = timestamp;

    console.error(
      `[RELAYER-MONITOR] [ERROR] [${timestamp}] Balance check failed for relayer ${address}: ${err.message} (Consecutive failures: ${state.consecutiveErrors})`
    );

    recordHistory({
      timestamp,
      balanceXlm: state.currentBalanceXlm,
      status: "ERROR",
      error: err.message,
      responseTimeMs
    });

    return {
      status: "ERROR",
      balanceXlm: state.currentBalanceXlm,
      error: err.message,
      responseTimeMs
    };
  }
}

// Starts the automated background relayer gas monitoring daemon
export function startRelayerMonitor() {
  if (state.isRunning) {
    console.log("[RELAYER-MONITOR] Monitor daemon is already running.");
    return;
  }

  if (!relayerKeypair) {
    state.status = "NOT_INITIALIZED";
    console.log("[RELAYER-MONITOR] Relayer keypair not configured. Monitor daemon skipped.");
    return;
  }

  state.isRunning = true;
  state.startedAt = new Date().toISOString();
  console.log(
    `[RELAYER-MONITOR] Starting automated background daemon. Interval: ${MONITOR_INTERVAL_MS / 1000}s | Warn Threshold: ${WARN_THRESHOLD_XLM} XLM | Critical Threshold: ${CRITICAL_THRESHOLD_XLM} XLM`
  );

  // Run immediate first check on startup
  performRelayerGasCheck().catch((e) => {
    console.error("[RELAYER-MONITOR] Startup check error:", e.message);
  });

  // Run periodic automated checks
  monitorIntervalId = setInterval(() => {
    performRelayerGasCheck().catch((e) => {
      console.error("[RELAYER-MONITOR] Periodic check error:", e.message);
    });
  }, MONITOR_INTERVAL_MS);

  if (monitorIntervalId && typeof monitorIntervalId.unref === "function") {
    // Allows Node to exit cleanly on shutdown without hanging on timer
    monitorIntervalId.unref();
  }
}

// Stops the background monitoring daemon
export function stopRelayerMonitor() {
  if (monitorIntervalId) {
    clearInterval(monitorIntervalId);
    monitorIntervalId = null;
  }
  state.isRunning = false;
  state.status = "STOPPED";
  console.log("[RELAYER-MONITOR] Background daemon stopped.");
}

// Returns full telemetry state for API endpoints and observability dashboards
export function getRelayerMonitorStatus() {
  const address = relayerKeypair ? relayerKeypair.publicKey() : null;
  const uptimeSeconds = state.startedAt ? Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000) : 0;

  return {
    isRunning: state.isRunning,
    status: state.status,
    address,
    currentBalanceXlm: state.currentBalanceXlm,
    thresholds: {
      warnXlm: WARN_THRESHOLD_XLM,
      criticalXlm: CRITICAL_THRESHOLD_XLM,
      intervalSeconds: MONITOR_INTERVAL_MS / 1000
    },
    uptimeSeconds,
    startedAt: state.startedAt,
    lastCheckedAt: state.lastCheckedAt,
    checkCount: state.checkCount,
    consecutiveErrors: state.consecutiveErrors,
    lastError: state.lastError,
    lastAlertSentAt: state.lastAlertSentAt ? new Date(state.lastAlertSentAt).toISOString() : null,
    recentChecks: state.recentChecks
  };
}
