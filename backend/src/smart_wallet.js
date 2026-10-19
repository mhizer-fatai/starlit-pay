import crypto from "node:crypto";
import * as StellarSdk from "@stellar/stellar-sdk";
import { app, rpc, NETWORK_PASSPHRASE, relayerKeypair, supabase } from "./config.js";
import { requireAuth } from "./auth.js";
import { checkRelayRequest, rawP256FromCose, RelayRuleError } from "./smart_wallet_rules.js";

// Public smart wallet: an OpenZeppelin smart account per user, controlled by a
// passkey that Stellar verifies on-chain (secp256r1). The frontend uses
// smart-account-kit; this module is its fee-sponsoring relayer, restricted by
// smart_wallet_rules.js, plus the user's wallet address.
//
// smart-account-kit's relayer client cannot send cookies, so it is pointed at
// /api/smart-wallet/relay/<token>, a short-lived token minted for the signed-in user.

const CONFIG = {
  // Canonical testnet deployments (smart-account-kit docs/deployments-protocol-27-2026-07-09.md)
  accountWasmHash: process.env.SMART_ACCOUNT_WASM_HASH || "1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a",
  webauthnVerifier: process.env.SMART_ACCOUNT_WEBAUTHN_VERIFIER || "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F",
  ed25519Verifier: process.env.SMART_ACCOUNT_ED25519_VERIFIER || "CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4",
  deployer: process.env.SMART_ACCOUNT_DEPLOYER || "GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N",
  usdcSac: process.env.USDC_SAC_CONTRACT_ID || "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
};
const XLM_SAC = StellarSdk.Asset.native().contractId(NETWORK_PASSPHRASE);
const TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_FEE_STROOPS = 50_000_000; // 5 XLM: refuse anything unusually expensive
const RELAYS_PER_HOUR = 30;

const tokenKey = process.env.AUTH_SESSION_SECRET
  ? Buffer.from(crypto.hkdfSync("sha256", process.env.AUTH_SESSION_SECRET, Buffer.alloc(0), "starlit-auth:smart-wallet-relay", 32))
  : null;

function mintToken(userId) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const body = `${userId}.${exp}`;
  const sig = crypto.createHmac("sha256", tokenKey).update(body).digest("base64url");
  return { token: Buffer.from(`${body}.${sig}`).toString("base64url"), expiresAt: exp };
}

function readToken(token) {
  try {
    const [userId, exp, sig] = Buffer.from(String(token), "base64url").toString("utf8").split(".");
    const expected = crypto.createHmac("sha256", tokenKey).update(`${userId}.${exp}`).digest("base64url");
    if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    if (Number(exp) < Date.now()) return null;
    return userId;
  } catch {
    return null;
  }
}

const recentRelays = new Map();
function withinRateLimit(userId) {
  const now = Date.now();
  const recent = (recentRelays.get(userId) ?? []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length >= RELAYS_PER_HOUR) return false;
  recent.push(now);
  recentRelays.set(userId, recent);
  return true;
}

async function walletContext(userId) {
  const { data: user, error } = await supabase.from("users").select("id, smart_wallet_address").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!user) return null;
  const { data: rows, error: pkError } = await supabase
    .from("passkeys")
    .select("id, credential_id, public_key, device_name, pending_until")
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (pkError) throw pkError;
  const now = Date.now();
  const passkeys = (rows ?? [])
    .filter((p) => !p.pending_until || new Date(p.pending_until).getTime() <= now)
    .map((p) => ({ id: p.id, credentialId: p.credential_id, deviceName: p.device_name, rawPublicKey: rawP256FromCose(p.public_key) }));
  return {
    walletAddress: user.smart_wallet_address ?? null,
    passkeys,
    deployer: CONFIG.deployer,
    accountWasmHash: CONFIG.accountWasmHash,
    webauthnVerifier: CONFIG.webauthnVerifier,
    tokens: [XLM_SAC, CONFIG.usdcSac],
    networkPassphrase: NETWORK_PASSPHRASE,
  };
}

async function waitForTx(hash) {
  for (let i = 0; i < 40; i++) {
    const res = await rpc.getTransaction(hash);
    if (res.status === "SUCCESS" || res.status === "FAILED") return res;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { status: "TIMEOUT" };
}

const fail = (res, status, message, code) => res.status(status).json({ success: false, error: message, ...(code ? { code } : {}) });

app.get("/api/smart-wallet", requireAuth, async (req, res) => {
  try {
    const ctx = await walletContext(req.user.id);
    if (!ctx) return res.status(404).json({ error: "User not found." });
    res.json({
      address: ctx.walletAddress,
      // Passkeys that can control an on-chain wallet (ES256 / secp256r1 only).
      passkeys: ctx.passkeys
        .filter((p) => p.rawPublicKey)
        .map((p) => ({ credentialId: p.credentialId, publicKey: p.rawPublicKey.toString("base64url"), deviceName: p.deviceName })),
      config: { ...CONFIG, xlmSac: XLM_SAC, networkPassphrase: NETWORK_PASSPHRASE },
    });
  } catch (err) {
    console.error("Smart wallet lookup failed:", err.message);
    res.status(500).json({ error: "Could not load your smart wallet." });
  }
});

app.post("/api/smart-wallet/relay-token", requireAuth, (req, res) => {
  if (!tokenKey || !relayerKeypair) return res.status(503).json({ error: "Smart wallet sponsoring is not configured." });
  res.json(mintToken(req.user.id));
});

app.post("/api/smart-wallet/relay/:token", async (req, res) => {
  if (!tokenKey || !relayerKeypair) return fail(res, 503, "Smart wallet sponsoring is not configured.");
  const userId = readToken(req.params.token);
  if (!userId) return fail(res, 401, "This request expired. Please try again.", "RELAY_TOKEN_INVALID");
  if (!withinRateLimit(userId)) return fail(res, 429, "Too many wallet transactions. Try again later.", "RATE_LIMITED");

  try {
    const ctx = await walletContext(userId);
    if (!ctx) return fail(res, 401, "Account not found.");
    let checked;
    try {
      checked = checkRelayRequest(req.body, ctx);
    } catch (err) {
      if (err instanceof RelayRuleError) return fail(res, 403, err.message, "NOT_SPONSORED");
      throw err;
    }

    const account = await rpc.getAccount(relayerKeypair.publicKey());
    let tx = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(StellarSdk.Operation.invokeHostFunction({ func: checked.func, auth: checked.auth }))
      .setTimeout(60)
      .build();
    tx = await rpc.prepareTransaction(tx);

    // The submitted authorization must be exactly what was checked.
    const preparedAuth = tx.operations[0].auth.map((a) => a.toXDR("base64")).sort().join();
    const checkedAuth = checked.auth.map((a) => a.toXDR("base64")).sort().join();
    if (preparedAuth !== checkedAuth) return fail(res, 403, "Authorization changed during preparation.", "NOT_SPONSORED");
    if (Number(tx.fee) > MAX_FEE_STROOPS) return fail(res, 403, "This transaction is too expensive to sponsor.", "FEE_TOO_HIGH");

    tx.sign(relayerKeypair);
    const sent = await rpc.sendTransaction(tx);
    if (sent.status === "ERROR") return fail(res, 502, "The network rejected the transaction.", "SUBMIT_FAILED");
    const done = await waitForTx(sent.hash);
    if (done.status !== "SUCCESS") return fail(res, 502, `Transaction ${done.status.toLowerCase()}.`, "TX_FAILED");

    if (checked.kind === "deploy") {
      await supabase
        .from("users")
        .update({ smart_wallet_address: checked.contractId, smart_wallet_created_at: new Date().toISOString() })
        .eq("id", userId)
        .is("smart_wallet_address", null);
    }
    console.log(`[SMART-WALLET] sponsored ${checked.kind} for user ${userId}: ${sent.hash}`);
    res.json({ success: true, data: { hash: sent.hash, status: "SUCCESS", ledger: done.ledger } });
  } catch (err) {
    console.error("[SMART-WALLET] relay failed:", err.message);
    fail(res, 500, "Could not submit the wallet transaction.", "RELAY_ERROR");
  }
});
