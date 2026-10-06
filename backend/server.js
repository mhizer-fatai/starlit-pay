import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import { app, PORT } from "./src/config.js";
import "./src/auth.js";
import "./src/relayer.js";
import "./src/asp_service.js";
import "./src/links.js";
import "./src/notes.js";
import "./src/transactions.js";
import { startIndexer } from "./src/indexer.js";
import { startGateway } from "./src/gateway.js";
import { startRelayerMonitor } from "./src/relayer_monitor.js";

// Start background services
startRelayerMonitor();
startIndexer();
startGateway();

// Start HTTP Server
app.listen(PORT, () => {
  console.log(`Starlit Pay backend database router listening on http://localhost:${PORT}`);
});