import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import { app, PORT } from "./src/config.js";
import "./src/auth.js";
import "./src/relayer.js";
import "./src/links.js";
import "./src/notes.js";
import "./src/transactions.js";
import { startIndexer } from "./src/indexer.js";
import { startGateway } from "./src/gateway.js";

// Start background services
startIndexer();
startGateway();

// Start HTTP Server
app.listen(PORT, () => {
  console.log(`Starlit Pay backend database router listening on http://localhost:${PORT}`);
});
