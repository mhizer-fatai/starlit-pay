import { Router } from "express";
import { asyncHandler, HttpError } from "../../http/errors.js";
import { validateBody } from "../../http/validate.js";
import { depositRequest } from "../../http/schemas.js";

export function createGatewayRouter({ processor, chain, gatewayAddress, logger }) {
  const router = Router();

  // The deposit address the daemon watches, so the app never shows a stale copy.
  router.get("/api/gateway/address", (req, res) => {
    res.status(200).json({ address: gatewayAddress });
  });

  // Credits a deposit right away instead of waiting for the next poll.
  router.post(
    "/api/gateway/deposit",
    validateBody(depositRequest),
    asyncHandler(async (req, res) => {
      const { txHash } = req.body;
      try {
        const result = await processor.processTransaction(await chain.fetchTransaction(txHash));
        res.status(200).json({ status: "ok", ...result });
      } catch (err) {
        logger.error(`Gateway deposit request for ${txHash} failed:`, err);
        throw new HttpError(500, "Could not process that deposit. It will be retried automatically.");
      }
    })
  );

  return router;
}
