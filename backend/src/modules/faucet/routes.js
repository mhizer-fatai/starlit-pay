import { Router } from "express";
import { asyncHandler, HttpError } from "../../http/errors.js";
import { validateBody } from "../../http/validate.js";
import { faucetFundRequest } from "../../http/schemas.js";

export function createFaucetRouter({ service, requireAuth }) {
  const router = Router();

  router.get(
    "/api/faucet/status/:viewingKey",
    asyncHandler(async (req, res) => {
      res.status(200).json(await service.status(req.params.viewingKey));
    })
  );

  // Funds the signed-in account only: the memo comes from the account, never the request.
  router.post(
    "/api/faucet/fund",
    requireAuth,
    validateBody(faucetFundRequest),
    asyncHandler(async (req, res) => {
      try {
        res.status(200).json(await service.fund(req.user.id, req.body));
      } catch (err) {
        // The page reads remainingMs to restart its countdown.
        if (err instanceof HttpError && err.code === "cooldown") {
          return res.status(429).json({ error: "Cooldown active", remainingMs: err.remainingMs, message: err.message });
        }
        throw err;
      }
    })
  );

  return router;
}
