import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as StellarSdk from "@stellar/stellar-sdk";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

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
    relayerKeypair = StellarSdk.Keypair.fromSecret(process.env.RELAYER_SECRET_KEY);
    console.log(`Relayer initialized with address: ${relayerKeypair.publicKey()}`);
  } catch (err) {
    console.error("Invalid RELAYER_SECRET_KEY configured:", err.message);
  }
}

// Loads gateway keypair if present in configuration
let gatewayKeypair = null;
if (process.env.GATEWAY_SECRET_KEY) {
  try {
    gatewayKeypair = StellarSdk.Keypair.fromSecret(process.env.GATEWAY_SECRET_KEY);
    console.log(`Gateway initialized with address: ${gatewayKeypair.publicKey()}`);
  } catch (err) {
    console.error("Invalid GATEWAY_SECRET_KEY configured:", err.message);
  }
}

// Middlewares
app.use(cors());
app.use(express.json());

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
