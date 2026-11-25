import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc, supabase, GATEWAY_ADDRESS, NETWORK_PASSPHRASE } from "../../config.js";
import { requireAuth } from "../../http/auth.js";
import { logger } from "../../http/logger.js";
import { USDC_ISSUER } from "../../tokens.js";
import { waitForTransaction } from "../../relayer_account.js";
import { channels } from "../zk_relayer/index.js";
import { createFaucetRepository } from "./repository.js";
import { createCaptchaVerifier, createFaucetService } from "./service.js";
import { createFaucetRouter } from "./routes.js";

const rawSecret = process.env.FAUCET_SCREATE_KEY || process.env.FAUCET_SECRET_KEY;
const faucetKeypair = rawSecret ? StellarSdk.Keypair.fromSecret(rawSecret.replace(/['"\s]/g, "")) : null;

/**
 * Pays the gateway with the user's memo, so the gateway shields it for them.
 * `channel` (optional) sends the transaction, so claims at the same moment
 * don't collide on the faucet's sequence numbers; the funds still come from
 * the faucet account, which signs its payments.
 */
async function buildAndSend({ memo, xlm, usdc }, channel = null) {
  const source = channel ?? faucetKeypair;
  const account = await rpc.getAccount(source.publicKey());
  const from = channel ? { source: faucetKeypair.publicKey() } : {};
  const builder = new StellarSdk.TransactionBuilder(account, { fee: "500", networkPassphrase: NETWORK_PASSPHRASE });
  if (xlm) builder.addOperation(StellarSdk.Operation.payment({ ...from, destination: GATEWAY_ADDRESS, asset: StellarSdk.Asset.native(), amount: xlm }));
  if (usdc) builder.addOperation(StellarSdk.Operation.payment({ ...from, destination: GATEWAY_ADDRESS, asset: new StellarSdk.Asset("USDC", USDC_ISSUER), amount: usdc }));
  const tx = builder.addMemo(StellarSdk.Memo.id(memo)).setTimeout(30).build();
  tx.sign(source);
  if (channel) tx.sign(faucetKeypair);
  const sent = await rpc.sendTransaction(tx);
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") throw new Error(`Faucet payment rejected: ${sent.status}`);
  return sent.hash;
}

async function sendPayment(drip) {
  if (!faucetKeypair) throw new Error("FAUCET_SECRET_KEY is not configured");
  if (!channels?.isReady()) return buildAndSend(drip);
  return channels.run(async (channel) => {
    const hash = await buildAndSend(drip, channel);
    // The channel is handed on only once this transaction has its outcome.
    // 45 s: past the 30 s expiry, so "not found" really means it never landed.
    const result = await waitForTransaction(rpc, hash, { attempts: 45 });
    if (result.status !== "SUCCESS") throw new Error(`Faucet payment ${String(result.status).toLowerCase()}`);
    return hash;
  });
}

const production = process.env.NODE_ENV === "production";
if (!process.env.TURNSTILE_SECRET_KEY) logger.info("Faucet captcha not enforced (TURNSTILE_SECRET_KEY not set).");

export const faucetRouter = createFaucetRouter({
  service: createFaucetService({
    repository: createFaucetRepository(supabase),
    sendPayment,
    verifyCaptcha: createCaptchaVerifier({ secret: process.env.TURNSTILE_SECRET_KEY, production }),
    logger,
  }),
  requireAuth,
});
