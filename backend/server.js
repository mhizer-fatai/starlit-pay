import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import { app, PORT } from "./src/config.js";
import "./src/auth.js";
import "./src/relayer.js";
import "./src/asp_service.js";
import "./src/links.js";
import "./src/notes.js";
import "./src/prices.js";
import "./src/settings.js";
import "./src/statements.js";
import "./src/transactions.js";
import "./src/pool_root.js";
import "./src/smart_wallet.js";
import { startIndexer } from "./src/indexer.js";
import { startGateway } from "./src/gateway.js";
import { startRelayerMonitor } from "./src/relayer_monitor.js";
import { startTtlKeeper } from "./src/ttl_keeper.js";

// Start background services. Set BACKGROUND_JOBS=off for a local server that
// shares production's database and wallets, so deposits are never processed twice.
startRelayerMonitor();
if (process.env.BACKGROUND_JOBS === "off") {
  console.log("Background jobs disabled (BACKGROUND_JOBS=off): indexer, gateway and TTL keeper not started.");
} else {
  startIndexer();
  startGateway();
  startTtlKeeper();
}

// Start HTTP Server
app.listen(PORT, () => {
  console.log(`Starlit Pay backend database router listening on http://localhost:${PORT}`);
});