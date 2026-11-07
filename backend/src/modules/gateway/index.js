import * as StellarSdk from "@stellar/stellar-sdk";
import { horizon, supabase, gatewayKeypair, GATEWAY_ADDRESS, NETWORK_PASSPHRASE } from "../../config.js";
import { isAddressBlocked } from "../../asp_service.js";
import { createDaemonState } from "../../daemon_state.js";
import { logger } from "../../http/logger.js";
import { USDC_ISSUER } from "../../tokens.js";
import { ZK_DEPOSIT_LIMITS } from "../../zk_pools.js";
import { createGatewayChain } from "./chain.js";
import { createGatewayDaemon } from "./daemon.js";
import { createGatewayRepository } from "./repository.js";
import { createGatewayRouter } from "./routes.js";
import { createDepositProcessor } from "./service.js";

const POLL_INTERVAL_MS = 15_000;

const chain = createGatewayChain({ horizon, gatewayAddress: GATEWAY_ADDRESS });
const processor = createDepositProcessor({
  repository: createGatewayRepository(supabase),
  chain,
  isAddressBlocked,
  gatewayAddress: GATEWAY_ADDRESS,
  networkPassphrase: NETWORK_PASSPHRASE,
  limits: ZK_DEPOSIT_LIMITS,
  logger,
});

export const gatewayRouter = createGatewayRouter({ processor, chain, gatewayAddress: GATEWAY_ADDRESS, logger });

async function ensureGatewayTrustlines() {
  const account = await horizon.loadAccount(gatewayKeypair.publicKey());
  // The pools' USDC only: payments in any other USDC are not credited.
  if (account.balances.some((b) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER)) return;
  logger.info(`Gateway: establishing trustline for USDC issuer ${USDC_ISSUER}...`);
  const tx = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(StellarSdk.Operation.changeTrust({ asset: new StellarSdk.Asset("USDC", USDC_ISSUER), limit: "900000000000" }))
    .setTimeout(30)
    .build();
  tx.sign(gatewayKeypair);
  await horizon.submitTransaction(tx);
  logger.info(`Gateway: added trustline for USDC issuer ${USDC_ISSUER}`);
}

export function startGateway() {
  if (!gatewayKeypair) {
    logger.info("Deposit gateway daemon skipped (GATEWAY_SECRET_KEY not set).");
    return;
  }
  logger.info(`Deposit gateway daemon started on address: ${gatewayKeypair.publicKey()}`);
  ensureGatewayTrustlines().catch((err) => logger.error("Gateway trustline setup warning:", err));
  const tick = createGatewayDaemon({ processor, chain, state: createDaemonState(supabase), logger });
  setInterval(tick, POLL_INTERVAL_MS);
}
