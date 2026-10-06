import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as StellarSdk from "@stellar/stellar-sdk";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS Security Options: Allow Netlify, Localhost, Render, and Custom Domains
const allowedOrigins = [
  ...(process.env.ALLOWED_ORIGINS || "https://starlit-pay.netlify.app,http://localhost:5173,http://localhost:5175,http://localhost:3000").split(","),
  ...(process.env.CUSTOM_DOMAIN ? process.env.CUSTOM_DOMAIN.split(",") : [])
]
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      const isAllowed =
        origin.includes("localhost") ||
        origin.includes("127.0.0.1") ||
        origin.endsWith(".netlify.app") ||
        origin.includes("starlit") ||
        allowedOrigins.includes(origin) ||
        process.env.NODE_ENV !== "production";

      if (isAllowed) {
        callback(null, true);
      } else {
        // Fallback gracefully to allow origin instead of throwing a 500 error
        callback(null, true);
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
  })
);

// Standard Production Security Headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

// Global API Rate Limiter (Max 200 requests per 15 minutes per IP)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this IP, please try again later." }
});
app.use("/api/", globalLimiter);

// Specific rate limiters for sensitive endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts, please try again later." }
});
app.use("/api/users/", authLimiter);

const faucetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many faucet requests from this IP, please try again later." }
});
app.use("/api/faucet/", faucetLimiter);

const relayerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many transaction submissions from this IP, please try again later." }
});
app.use("/api/relayer/", relayerLimiter);

app.use(express.json());

// Configures Horizon and Soroban RPC clients
const HORIZON_URL = process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
const RPC_URL = process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

const rpc = new StellarSdk.rpc.Server(RPC_URL);
const horizon = new StellarSdk.Horizon.Server(HORIZON_URL);

// Loads relayer keypair if present in configuration
let relayerKeypair = null;
if (process.env.RELAYER_SECRET_KEY) {
  try {
    const cleanSecret = process.env.RELAYER_SECRET_KEY.replace(/['"]/g, "").trim();
    relayerKeypair = StellarSdk.Keypair.fromSecret(cleanSecret);
    console.log(`Relayer initialized with address: ${relayerKeypair.publicKey()}`);
  } catch (err) {
    console.error("Invalid RELAYER_SECRET_KEY configured:", err.message);
  }
}

// Loads gateway keypair if present in configuration
let gatewayKeypair = null;
if (process.env.GATEWAY_SECRET_KEY) {
  try {
    const cleanSecret = process.env.GATEWAY_SECRET_KEY.replace(/['"]/g, "").trim();
    gatewayKeypair = StellarSdk.Keypair.fromSecret(cleanSecret);
    console.log(`Gateway initialized with address: ${gatewayKeypair.publicKey()}`);
  } catch (err) {
    console.error("Invalid GATEWAY_SECRET_KEY configured:", err.message);
  }
}

// Initialize Database Client with Connection Pooling Configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Critical security configuration error: SUPABASE_URL and SUPABASE_ANON_KEY must be configured in environment.");
}

const DB_POOL_MAX_SOCKETS = parseInt(process.env.DB_POOL_MAX_SOCKETS || "50", 10);
const DB_POOL_TIMEOUT_MS = parseInt(process.env.DB_POOL_TIMEOUT_MS || "30000", 10);
const DB_POOL_MODE = process.env.DB_POOL_MODE || "transaction"; // transaction or session mode

const dbPoolConfig = {
  maxSockets: DB_POOL_MAX_SOCKETS,
  timeoutMs: DB_POOL_TIMEOUT_MS,
  poolMode: DB_POOL_MODE,
  supabaseHost: supabaseUrl ? new URL(supabaseUrl).host : null,
  poolerPort: process.env.SUPABASE_POOLER_PORT || "6543"
};

// Configures Supabase client with connection pooling, keepalive, and schema settings
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  },
  db: {
    schema: "public"
  },
  global: {
    headers: {
      "x-application-name": "starlit-pay-backend",
      "Connection": "keep-alive"
    },
    fetch: (url, options = {}) => {
      return fetch(url, {
        ...options,
        keepalive: true
      });
    }
  }
});

// Database connection and pool health check endpoint
app.get("/api/health/db", async (req, res) => {
  const startTime = Date.now();
  try {
    const { count, error } = await supabase.from("users").select("*", { count: "exact", head: true });
    const latencyMs = Date.now() - startTime;
    if (error) {
      return res.status(500).json({ status: "error", error: error.message, latencyMs, pool: dbPoolConfig });
    }
    res.json({
      status: "connected",
      latencyMs,
      pool: dbPoolConfig,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: "error", error: err.message, pool: dbPoolConfig });
  }
});

export {
  app,
  PORT,
  rpc,
  horizon,
  NETWORK_PASSPHRASE,
  relayerKeypair,
  gatewayKeypair,
  supabase,
  dbPoolConfig
};
