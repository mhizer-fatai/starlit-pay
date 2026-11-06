import rateLimit from "express-rate-limit";
import { NETWORK_PASSPHRASE, zkPayerKeypair } from "../../config.js";
import { isAddressBlocked } from "../../asp_service.js";
import { authLayer } from "../../auth_layer/mount.js";
import { requireAuth } from "../../http/auth.js";
import { logger } from "../../http/logger.js";
import { createPaymentApproval } from "../../payment_approval.js";
import { createZkPayer } from "./service.js";
import { createZkPayerRouter } from "./routes.js";
import { ZK_POOLS } from "../../zk_pools.js";

const pools = Object.values(ZK_POOLS);

export const zkPayerRouter = createZkPayerRouter({
  payer: createZkPayer({ payerKeypair: zkPayerKeypair, networkPassphrase: NETWORK_PASSPHRASE, pools, isAddressBlocked, logger }),
  requireAuth,
  requirePaymentApproval: createPaymentApproval({ sessions: authLayer.sessions }),
  limiter: rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many payments. Try again later." } }),
});
