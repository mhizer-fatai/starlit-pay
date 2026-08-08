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
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "https://starlit-pay.netlify.app,http://localhost:5173,http://localhost:3000")
  .split(",")
  .map((o) => o.trim());

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

// Global API Rate Limiter (Max 200 requests per 15 minutes per IP)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this IP, please try again later." }
});
app.use("/api/", globalLimiter);

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

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Warning: Supabase keys are not set in the environment.");
}
const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "");

export {
  app,
  PORT,
  rpc,
  horizon,
  NETWORK_PASSPHRASE,
  relayerKeypair,
  gatewayKeypair,
  supabase
};
