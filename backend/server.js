import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import { PORT } from "./src/config.js";
import { app } from "./src/http/app.js";
import { authLayer } from "./src/auth_layer/mount.js";
import { usersRouter } from "./src/modules/users/index.js";
import { settingsRouter } from "./src/modules/settings/index.js";
import { complianceRouter } from "./src/modules/compliance/index.js";
import { relayerRouter } from "./src/modules/relayer/index.js";
import { paymentLinksRouter } from "./src/modules/payment_links/index.js";
import { notesRouter } from "./src/modules/notes/index.js";
import { faucetRouter } from "./src/modules/faucet/index.js";
import { statsRouter } from "./src/modules/stats/index.js";
import { healthRouter } from "./src/modules/health/index.js";
import { pricesRouter } from "./src/modules/prices/index.js";
import { transactionsRouter } from "./src/modules/transactions/index.js";
import { poolRouter } from "./src/modules/pool/index.js";
import { smartWalletRouter } from "./src/modules/smart_wallet/index.js";
import { zkPayerRouter } from "./src/modules/zk_payer/index.js";
import { zkKeysRouter } from "./src/modules/zk_keys/index.js";
import { gatewayRouter, startGateway } from "./src/modules/gateway/index.js";
import { startIndexer } from "./src/indexer.js";
import { startRelayerMonitor } from "./src/relayer_monitor.js";
import { startTtlKeeper } from "./src/ttl_keeper.js";
import { errorMiddleware, notFound } from "./src/http/errors.js";
import { logger } from "./src/http/logger.js";

// Every route, in one place. Middleware runs first (src/http/app.js).
for (const router of [
  authLayer.router,
  usersRouter,
  settingsRouter,
  complianceRouter,
  relayerRouter,
  paymentLinksRouter,
  notesRouter,
  faucetRouter,
  statsRouter,
  healthRouter,
  pricesRouter,
  transactionsRouter,
  poolRouter,
  smartWalletRouter,
  zkPayerRouter,
  zkKeysRouter,
  gatewayRouter,
]) {
  app.use(router);
}

// Start background services. Set BACKGROUND_JOBS=off for a local server that
// shares production's database and wallets, so deposits are never processed twice.
startRelayerMonitor();
if (process.env.BACKGROUND_JOBS === "off") {
  logger.info("Background jobs disabled (BACKGROUND_JOBS=off): indexer, gateway and TTL keeper not started.");
} else {
  startIndexer();
  startGateway();
  startTtlKeeper();
}

// Root: a short service description instead of Express's "Cannot GET /".
const startedAt = new Date().toISOString();
app.get("/", (req, res) => {
  res.json({
    service: "Starlit Pay API",
    status: "online",
    network: "Stellar Testnet",
    app: "https://starlitpay.xyz",
    startedAt,
    uptimeSeconds: Math.round(process.uptime()),
    checks: {
      health: "/api/health",
      database: "/api/health/db",
      relayerMonitor: "/api/relayer/daemon/status",
    },
  });
});

// Last, after every route.
app.use(notFound);
app.use(errorMiddleware);

// Start HTTP Server
const server = app.listen(PORT, () => {
  logger.info(`Starlit Pay backend listening on port ${PORT}`);
});

// Render stops the old instance with SIGTERM on every deploy: let requests in
// flight finish (a relayed payment can take many seconds), then exit.
const SHUTDOWN_GRACE_MS = 25_000;
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, finishing requests in flight`);
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => {
    logger.warn("Shutdown grace period ended with requests still open");
    process.exit(1);
  }, SHUTDOWN_GRACE_MS).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// A background job's stray rejection must not take payments down with it.
process.on("unhandledRejection", (reason) => logger.error("Unhandled promise rejection", reason));
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception, exiting", err);
  process.exit(1);
});