import { app, supabase, rpc, relayerKeypair, GATEWAY_ADDRESS, NETWORK_PASSPHRASE } from "../../config.js";
import { requireAuth, sessionUser } from "../../auth.js";
import { createTransactionReader } from "./chain.js";
import { createPaymentLinksRepository } from "./repository.js";
import { createPaymentLinksService } from "./service.js";
import { createPaymentLinksRouter } from "./routes.js";

const service = createPaymentLinksService({
  repository: createPaymentLinksRepository(supabase),
  readTransaction: createTransactionReader({ rpc, networkPassphrase: NETWORK_PASSPHRASE }),
  gatewayAddress: GATEWAY_ADDRESS,
  relayerAddress: relayerKeypair?.publicKey(),
  poolContract: process.env.SHIELDED_POOL_CONTRACT_ID,
});
app.use(createPaymentLinksRouter({ service, requireAuth, currentUser: sessionUser }));
