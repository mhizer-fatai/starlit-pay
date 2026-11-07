import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc, NETWORK_PASSPHRASE, relayerKeypair, supabase, GATEWAY_ADDRESS } from "../../config.js";
import { ZK_DEPOSIT_LIMITS } from "../../zk_pools.js";
import { createDirectCredits } from "../zk_gateway/direct_credits.js";
import { createZkGatewayRepository } from "../zk_gateway/repository.js";
import { requireAuth } from "../../http/auth.js";
import { logger } from "../../http/logger.js";
import { withRelayerAccount } from "../../relayer_account.js";
import { createSponsorChain } from "./chain.js";
import { createRelayTokens } from "./relay_token.js";
import { createSmartWalletRepository } from "./repository.js";
import { createSmartWalletRouter } from "./routes.js";
import { createSmartWalletService } from "./service.js";

// Canonical testnet deployments (smart-account-kit docs/deployments-protocol-27-2026-07-09.md)
const config = {
  accountWasmHash: process.env.SMART_ACCOUNT_WASM_HASH || "1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a",
  webauthnVerifier: process.env.SMART_ACCOUNT_WEBAUTHN_VERIFIER || "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F",
  ed25519Verifier: process.env.SMART_ACCOUNT_ED25519_VERIFIER || "CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4",
  deployer: process.env.SMART_ACCOUNT_DEPLOYER || "GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N",
  usdcSac: process.env.USDC_SAC_CONTRACT_ID || "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  xlmSac: StellarSdk.Asset.native().contractId(NETWORK_PASSPHRASE),
  networkPassphrase: NETWORK_PASSPHRASE,
};

export const smartWalletRouter = createSmartWalletRouter({
  service: createSmartWalletService({
    repository: createSmartWalletRepository(supabase, logger),
    chain: createSponsorChain({ rpc, relayerKeypair, networkPassphrase: NETWORK_PASSPHRASE, queue: withRelayerAccount }),
    tokens: createRelayTokens(process.env.AUTH_SESSION_SECRET),
    config,
    // Public funds sent to the gateway become the user's private-balance credit.
    gateway: {
      address: GATEWAY_ADDRESS,
      minStroops: ZK_DEPOSIT_LIMITS.minDeposit,
      onTransfer: createDirectCredits({
        repository: createZkGatewayRepository(supabase),
        gatewayAddress: GATEWAY_ADDRESS,
        tokens: { XLM: config.xlmSac, USDC: config.usdcSac },
        logger,
      }),
    },
    logger,
  }),
  requireAuth,
  logger,
});
