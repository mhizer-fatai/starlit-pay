import { supabase, rpc, relayerKeypair, GATEWAY_ADDRESS, NETWORK_PASSPHRASE } from "../../config.js";
import { ZK_POOLS } from "../../zk_pools.js";
import { channels } from "../zk_relayer/index.js";
import { requireAuth, sessionUser } from "../../http/auth.js";
import { createTransactionReader } from "./chain.js";
import { createPaymentLinksRepository } from "./repository.js";
import { createPaymentLinksService } from "./service.js";
import { createPaymentLinksRouter } from "./routes.js";

const service = createPaymentLinksService({
  repository: createPaymentLinksRepository(supabase),
  readTransaction: createTransactionReader({ rpc, networkPassphrase: NETWORK_PASSPHRASE }),
  gatewayAddress: GATEWAY_ADDRESS,
  // Private payments are sent by the relayer, or by one of its channels.
  senderAddresses: [relayerKeypair?.publicKey(), ...(channels?.addresses ?? [])].filter(Boolean),
  pools: Object.values(ZK_POOLS),
});
export const paymentLinksRouter = createPaymentLinksRouter({ service, requireAuth, currentUser: sessionUser });
