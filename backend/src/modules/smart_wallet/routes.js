import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../../http/errors.js";
import { validateBody } from "../../http/validate.js";

const birthRequest = z.object({ txHash: z.string().trim().toLowerCase().pipe(z.string().regex(/^[0-9a-f]{64}$/, "expected a transaction hash")) });

export function createSmartWalletRouter({ service, requireAuth, logger }) {
  const router = Router();

  router.get(
    "/api/smart-wallet",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await service.wallet(req.user.id));
    })
  );

  router.post(
    "/api/smart-wallet/birth",
    requireAuth,
    validateBody(birthRequest),
    asyncHandler(async (req, res) => {
      res.json({ birth: await service.recordBirth(req.user.id, req.body.txHash) });
    })
  );

  router.post("/api/smart-wallet/relay-token", requireAuth, (req, res) => {
    res.json(service.relayToken(req.user.id));
  });

  // smart-account-kit reads this exact shape: { success, data } or { success: false, error, code }.
  router.post("/api/smart-wallet/relay/:token", async (req, res) => {
    try {
      res.json({ success: true, data: await service.relay(req.params.token, req.body) });
    } catch (err) {
      if (!(err instanceof HttpError)) logger.error("[SMART-WALLET] relay failed:", err);
      const known = err instanceof HttpError;
      res.status(known ? err.status : 500).json({
        success: false,
        error: known ? err.message : "Could not submit the wallet transaction.",
        code: known ? err.code : "RELAY_ERROR",
      });
    }
  });

  return router;
}
