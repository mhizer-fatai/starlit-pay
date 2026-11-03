import * as StellarSdk from "@stellar/stellar-sdk";
import { app, rpc, supabase, GATEWAY_ADDRESS, NETWORK_PASSPHRASE } from "../../config.js";
import { requireAuth } from "../../auth.js";
import { logger } from "../../http/logger.js";
import { USDC_ISSUER } from "../../tokens.js";
import { createFaucetRepository } from "./repository.js";
import { createCaptchaVerifier, createFaucetService } from "./service.js";
import { createFaucetRouter } from "./routes.js";

const rawSecret = process.env.FAUCET_SCREATE_KEY || process.env.FAUCET_SECRET_KEY;
const faucetKeypair = rawSecret ? StellarSdk.Keypair.fromSecret(rawSecret.replace(/['"\s]/g, "")) : null;

/** Pays the gateway with the user's memo, so the gateway shields it for them. */
async function sendPayment({ memo, xlm, usdc }) {
  if (!faucetKeypair) throw new Error("FAUCET_SECRET_KEY is not configured");
  const account = await rpc.getAccount(faucetKeypair.publicKey());
  const builder = new StellarSdk.TransactionBuilder(account, { fee: "500", networkPassphrase: NETWORK_PASSPHRASE });
  if (xlm) builder.addOperation(StellarSdk.Operation.payment({ destination: GATEWAY_ADDRESS, asset: StellarSdk.Asset.native(), amount: xlm }));
  if (usdc) builder.addOperation(StellarSdk.Operation.payment({ destination: GATEWAY_ADDRESS, asset: new StellarSdk.Asset("USDC", USDC_ISSUER), amount: usdc }));
  const tx = builder.addMemo(StellarSdk.Memo.id(memo)).setTimeout(30).build();
  tx.sign(faucetKeypair);
  const sent = await rpc.sendTransaction(tx);
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") throw new Error(`Faucet payment rejected: ${sent.status}`);
  return sent.hash;
}

const production = process.env.NODE_ENV === "production";
if (!process.env.TURNSTILE_SECRET_KEY) logger.info("Faucet captcha not enforced (TURNSTILE_SECRET_KEY not set).");

app.use(
  createFaucetRouter({
    service: createFaucetService({
      repository: createFaucetRepository(supabase),
      sendPayment,
      verifyCaptcha: createCaptchaVerifier({ secret: process.env.TURNSTILE_SECRET_KEY, production }),
      logger,
    }),
    requireAuth,
  })
);
