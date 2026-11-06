import rateLimit from "express-rate-limit";
import { gatewayKeypair, NETWORK_PASSPHRASE, rpc, supabase } from "../../config.js";
import { requireAuth } from "../../http/auth.js";
import { logger } from "../../http/logger.js";
import { ZK_POOLS } from "../../zk_pools.js";
import { createZkGatewayRepository } from "./repository.js";
import { createZkGatewayRouter } from "./routes.js";
import { createZkGateway } from "./service.js";

export const zkGatewayRouter = createZkGatewayRouter({
  gateway: createZkGateway({
    gatewayKeypair,
    networkPassphrase: NETWORK_PASSPHRASE,
    poolsByAsset: ZK_POOLS,
    repository: createZkGatewayRepository(supabase),
    transactionStatus: async (hash) => (await rpc.getTransaction(hash)).status,
    logger,
  }),
  requireAuth,
  limiter: rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests. Try again later." } }),
});
