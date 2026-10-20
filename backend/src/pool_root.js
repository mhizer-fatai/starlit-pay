import * as StellarSdk from "@stellar/stellar-sdk";
import { app, rpc, NETWORK_PASSPHRASE, supabase } from "./config.js";

// A Merkle root the shielded pool currently accepts. Spends need one, but notes
// posted by clients (received payments, change) are stored without a root, and
// the pool accepts any root it has recorded. The newest roots seen by the
// indexer are checked on-chain with is_root_valid before one is returned.

const CACHE_TTL_MS = 60 * 1000;
const CANDIDATES = 10;
const SIM_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

let cache = { root: null, at: 0 };

async function isRootValid(contractId, rootHex) {
  const contract = new StellarSdk.Contract(contractId);
  const rootVal = StellarSdk.nativeToScVal(Buffer.from(rootHex, "hex"), { type: "bytes" });
  const tx = new StellarSdk.TransactionBuilder(new StellarSdk.Account(SIM_SOURCE, "0"), {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("is_root_valid", rootVal))
    .setTimeout(30)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  return Boolean(sim?.result?.retval && StellarSdk.scValToNative(sim.result.retval));
}

export async function currentPoolRoot() {
  if (cache.root && Date.now() - cache.at < CACHE_TTL_MS) return cache.root;
  const contractId = process.env.SHIELDED_POOL_CONTRACT_ID;
  if (!contractId) return null;

  const { data, error } = await supabase
    .from("shielded_notes")
    .select("root, ledger")
    .not("root", "is", null)
    .order("ledger", { ascending: false, nullsFirst: false })
    .limit(CANDIDATES);
  if (error) throw error;

  const seen = new Set();
  for (const { root } of data ?? []) {
    if (!/^[0-9a-f]{64}$/.test(root) || seen.has(root)) continue;
    seen.add(root);
    if (await isRootValid(contractId, root)) {
      cache = { root, at: Date.now() };
      return root;
    }
  }
  return null;
}

app.get("/api/pool/root", async (_req, res) => {
  try {
    const root = await currentPoolRoot();
    if (!root) return res.status(503).json({ error: "No valid pool root is available right now." });
    res.json({ root });
  } catch (err) {
    console.error("Pool root lookup failed:", err.message);
    res.status(500).json({ error: "Could not look up the pool root." });
  }
});
