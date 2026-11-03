import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc, horizon, supabase, gatewayKeypair, GATEWAY_ADDRESS, NETWORK_PASSPHRASE } from "../../config.js";
import { calculateCommitment, encryptNoteForUser } from "../../crypto.js";
import { isAddressBlocked } from "../../asp_service.js";
import { createDaemonState } from "../../daemon_state.js";
import { logger } from "../../http/logger.js";
import { USDC_ISSUER } from "../../tokens.js";
import { createGatewayChain } from "./chain.js";
import { createGatewayDaemon } from "./daemon.js";
import { createGatewayRepository } from "./repository.js";
import { createGatewayRouter } from "./routes.js";
import { createDepositProcessor } from "./service.js";

const POLL_INTERVAL_MS = 15_000;

const chain = gatewayKeypair ? createGatewayChain({ rpc, horizon, gatewayKeypair, networkPassphrase: NETWORK_PASSPHRASE }) : null;
const processor = gatewayKeypair
  ? createDepositProcessor({
      repository: createGatewayRepository(supabase),
      chain,
      isAddressBlocked,
      calculateCommitment,
      encryptNoteForUser,
      gatewayAddress: gatewayKeypair.publicKey(),
      gatewaySecret: gatewayKeypair.secret(),
      poolContract: process.env.SHIELDED_POOL_CONTRACT_ID,
      networkPassphrase: NETWORK_PASSPHRASE,
      logger,
    })
  : {
      processTransaction: async () => {
        throw new Error("Gateway keypair is not configured.");
      },
    };

export const gatewayRouter = createGatewayRouter({ processor, chain: chain ?? { fetchTransaction: (hash) => horizon.transactions().transaction(hash).call() }, gatewayAddress: GATEWAY_ADDRESS, logger });

async function ensureGatewayTrustlines() {
  const account = await horizon.loadAccount(gatewayKeypair.publicKey());
  // The pool's USDC: payments in any other USDC are not credited.
  const usdcIssuers = [USDC_ISSUER];
  for (const issuer of usdcIssuers) {
    if (account.balances.some((b) => b.asset_code === "USDC" && b.asset_issuer === issuer)) continue;
    logger.info(`Gateway: establishing trustline for USDC issuer ${issuer}...`);
    const tx = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(StellarSdk.Operation.changeTrust({ asset: new StellarSdk.Asset("USDC", issuer), limit: "900000000000" }))
      .setTimeout(30)
      .build();
    tx.sign(gatewayKeypair);
    await horizon.submitTransaction(tx);
    logger.info(`Gateway: added trustline for USDC issuer ${issuer}`);
  }
}

export function startGateway() {
  if (!gatewayKeypair || !process.env.SHIELDED_POOL_CONTRACT_ID) {
    logger.info("Deposit gateway daemon skipped (GATEWAY_SECRET_KEY or SHIELDED_POOL_CONTRACT_ID not set).");
    return;
  }
  logger.info(`Deposit gateway daemon started on address: ${gatewayKeypair.publicKey()}`);
  ensureGatewayTrustlines().catch((err) => logger.error("Gateway trustline setup warning:", err));
  const tick = createGatewayDaemon({ processor, chain, state: createDaemonState(supabase), logger });
  setInterval(tick, POLL_INTERVAL_MS);
}
