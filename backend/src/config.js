import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as StellarSdk from "@stellar/stellar-sdk";
import { logger } from "./http/logger.js";

// Environment and shared clients: Stellar (Horizon, RPC), the service keys,
// and the database. Nothing here handles requests.

dotenv.config();

const PORT = process.env.PORT || 3001;

const HORIZON_URL = process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
const RPC_URL = process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

const rpc = new StellarSdk.rpc.Server(RPC_URL);
const horizon = new StellarSdk.Horizon.Server(HORIZON_URL);

function loadKeypair(envName, label) {
  if (!process.env[envName]) return null;
  try {
    const keypair = StellarSdk.Keypair.fromSecret(process.env[envName].replace(/['"]/g, "").trim());
    logger.info(`${label} initialized with address: ${keypair.publicKey()}`);
    return keypair;
  } catch (err) {
    logger.error(`Invalid ${envName} configured:`, err.message);
    return null;
  }
}

const relayerKeypair = loadKeypair("RELAYER_SECRET_KEY", "Relayer");
const gatewayKeypair = loadKeypair("GATEWAY_SECRET_KEY", "Gateway");

// The backend must use the secret service-role key: tables are locked to that
// role by RLS. The anon key is public (it ships in the frontend bundle).
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Critical security configuration error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured in environment.");
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  logger.warn("Security notice: SUPABASE_SERVICE_ROLE_KEY is not set; falling back to SUPABASE_ANON_KEY. Tables must not be readable by the public anon key.");
}

const dbPoolConfig = {
  maxSockets: parseInt(process.env.DB_POOL_MAX_SOCKETS || "50", 10),
  timeoutMs: parseInt(process.env.DB_POOL_TIMEOUT_MS || "30000", 10),
  poolMode: process.env.DB_POOL_MODE || "transaction",
  supabaseHost: new URL(supabaseUrl).host,
  poolerPort: process.env.SUPABASE_POOLER_PORT || "6543",
};

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: "public" },
  global: {
    headers: { "x-application-name": "starlit-pay-backend", Connection: "keep-alive" },
    fetch: (url, options = {}) => fetch(url, { ...options, keepalive: true }),
  },
});

// Single source of truth for the deposit gateway address:
// explicit env override first, then the daemon keypair's address, then the
// well-known fallback. The faucet, the daemon, and the /api/gateway/address
// endpoint all resolve through this so they can never disagree.
const GATEWAY_ADDRESS = process.env.GATEWAY_PUBLIC_KEY || gatewayKeypair?.publicKey() || "GCDQQE7CPLIGMAH4QEB2SSIEAS5MZMFSQAYSEJYSF7P5ZLA6HOU4BWWY";

export { PORT, rpc, horizon, NETWORK_PASSPHRASE, relayerKeypair, gatewayKeypair, supabase, dbPoolConfig, GATEWAY_ADDRESS };
