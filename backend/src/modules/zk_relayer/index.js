import rateLimit from "express-rate-limit";
import { NETWORK_PASSPHRASE, relayerKeypair, rpc, horizon } from "../../config.js";
import { isAddressBlocked } from "../../asp_service.js";
import { authLayer } from "../../auth_layer/mount.js";
import { createChannelPool, createChannelTopUp, deriveChannelKeypairs } from "../../channels.js";
import { requireAuth } from "../../http/auth.js";
import { logger } from "../../http/logger.js";
import { createPaymentApproval } from "../../payment_approval.js";
import { createZkRelayer } from "./service.js";
import { createZkRelayerRouter } from "./routes.js";
import { ZK_POOLS } from "../../zk_pools.js";

const pools = Object.values(ZK_POOLS);

// CHANNEL_COUNT channel accounts, derived from the relayer's key (see channels.js).
// 0 (the default) keeps every payment on the relayer account, as before.
// The server creates and funds them itself from the relayer (see topUpChannels,
// run with the background jobs), and uses them once they exist.
const channelCount = Math.max(0, Math.min(100, parseInt(process.env.CHANNEL_COUNT || "0", 10) || 0));

export const channels =
  relayerKeypair && channelCount
    ? createChannelPool({
        keypairs: deriveChannelKeypairs(relayerKeypair, channelCount),
        transactionStatus: async (hash) => (await rpc.getTransaction(hash)).status,
      })
    : null;

/** Keeps every channel funded for its fees; run periodically by the background jobs. */
export const topUpChannels = channels
  ? createChannelTopUp({ addresses: channels.addresses, relayerKeypair: relayerKeypair, horizon, rpc, networkPassphrase: NETWORK_PASSPHRASE, logger })
  : null;

logger.info(channels ? `Payments use ${channels.size} channel accounts.` : "Payments use the relayer account alone (CHANNEL_COUNT not set).");

export const zkRelayerRouter = createZkRelayerRouter({
  relayer: createZkRelayer({ relayerKeypair: relayerKeypair, channels, networkPassphrase: NETWORK_PASSPHRASE, pools, isAddressBlocked, logger }),
  requireAuth,
  requirePaymentApproval: createPaymentApproval({ sessions: authLayer.sessions }),
  limiter: rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many payments. Try again later." } }),
});
