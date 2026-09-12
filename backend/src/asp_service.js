import * as StellarSdk from "@stellar/stellar-sdk";
import { app, rpc, NETWORK_PASSPHRASE } from "./config.js";

const ASP_CONTRACT_ID = process.env.ASP_CONTRACT_ID || null;
const CACHE_TTL_MS = 60 * 1000;
const complianceCache = new Map();

// Known test/sanction addresses for local testing and simulation
const DEFAULT_SANCTION_LIST = new Set([
  // Example known blacklisted/bad actor accounts for test purposes
  "GBADACTORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
]);

/**
 * Checks whether an address is blocked according to the ASP (Association Set Provider) policy.
 * Queries the Soroban ASP contract if configured, falling back to local list and in-memory cache.
 *
 * @param {string} address - Stellar G... or C... address to check
 * @returns {Promise<boolean>} - true if address is blocked/sanctioned, false otherwise
 */
export async function isAddressBlocked(address) {
  if (!address || typeof address !== "string") {
    return false;
  }

  // Check local known sanctions list
  if (DEFAULT_SANCTION_LIST.has(address)) {
    return true;
  }

  // Check in-memory cache
  const cached = complianceCache.get(address);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.blocked;
  }

  // If no ASP contract ID is set, allow (with caching)
  if (!ASP_CONTRACT_ID || !/^C[A-Z2-7]{55}$/.test(ASP_CONTRACT_ID)) {
    complianceCache.set(address, { blocked: false, timestamp: Date.now() });
    return false;
  }

  try {
    const contract = new StellarSdk.Contract(ASP_CONTRACT_ID);
    const targetVal = StellarSdk.Address.fromString(address).toScVal();

    // Call read-only query on ASP contract: is_address_blocked
    const simTx = new StellarSdk.TransactionBuilder(
      new StellarSdk.Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0"),
      {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      }
    )
      .addOperation(contract.call("is_address_blocked", targetVal))
      .setTimeout(30)
      .build();

    const simRes = await rpc.simulateTransaction(simTx);
    if (simRes && simRes.result && simRes.result.retval) {
      const isBlocked = StellarSdk.scValToNative(simRes.result.retval);
      complianceCache.set(address, { blocked: Boolean(isBlocked), timestamp: Date.now() });
      return Boolean(isBlocked);
    }

    complianceCache.set(address, { blocked: false, timestamp: Date.now() });
    return false;
  } catch (err) {
    console.warn(`[ASP Check] Failed to query ASP contract for ${address}:`, err.message);
    // In case of transient RPC error, fallback to cache or allow to prevent service disruption
    return false;
  }
}

/**
 * Public API endpoint to check if an address passes ASP compliance screening.
 * Used by frontend before generating proofs or initiating withdrawals.
 */
app.get("/api/compliance/check/:address", async (req, res) => {
  const { address } = req.params;

  if (!address || !StellarSdk.StrKey.isValidEd25519PublicKey(address)) {
    return res.status(400).json({ error: "Invalid Stellar public address format." });
  }

  try {
    const blocked = await isAddressBlocked(address);
    res.json({
      address,
      blocked,
      status: blocked ? "BLOCKED" : "CLEAN",
      aspContract: ASP_CONTRACT_ID || "local-compliance-filter"
    });
  } catch (err) {
    console.error("Compliance endpoint error:", err.message);
    res.status(500).json({ error: "Failed to evaluate compliance status." });
  }
});
