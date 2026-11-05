import rateLimit from "express-rate-limit";
import { NETWORK_PASSPHRASE, zkPayerKeypair } from "../../config.js";
import { isAddressBlocked } from "../../asp_service.js";
import { authLayer } from "../../auth_layer/mount.js";
import { requireAuth } from "../../http/auth.js";
import { logger } from "../../http/logger.js";
import { createPaymentApproval } from "../../payment_approval.js";
import { createZkPayer } from "./service.js";
import { createZkPayerRouter } from "./routes.js";

// The SPP pools (real proofs) on testnet; ZK_POOL_IDS overrides them.
const DEFAULT_POOLS = [
  "CBPXO3XY6DVA4K6MU3K2JFYUOLUBFOMP2ACFFNVUP5LQZUZXFSTABPUX", // XLM
  "CBRXBWOEVQRNP7ZLGUTKG5UQBEFSOLLVHV4UEEVBKRPECB763YGHANLY", // USDC
];
const pools = (process.env.ZK_POOL_IDS ?? DEFAULT_POOLS.join(",")).split(",").map((id) => id.trim()).filter(Boolean);

export const zkPayerRouter = createZkPayerRouter({
  payer: createZkPayer({ payerKeypair: zkPayerKeypair, networkPassphrase: NETWORK_PASSPHRASE, pools, isAddressBlocked, logger }),
  requireAuth,
  requirePaymentApproval: createPaymentApproval({ sessions: authLayer.sessions }),
  limiter: rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many payments. Try again later." } }),
});
