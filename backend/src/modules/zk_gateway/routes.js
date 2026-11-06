import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../http/errors.js";
import { validateBody } from "../../http/validate.js";

const signRequest = z.object({
  id: z.string().regex(/^[0-9a-f]{64}:\d{1,4}$/, "expected a deposit id"),
  xdr: z.string().min(1).max(32_768).regex(/^[A-Za-z0-9+/=]+$/, "expected base64 XDR"),
});

export function createZkGatewayRouter({ gateway, requireAuth, limiter }) {
  const router = Router();

  // Payments received for the user that their device still has to deposit.
  router.get(
    "/api/zk/deposits",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({ gateway: gateway.address, deposits: await gateway.list(req.user.id) });
    })
  );

  router.post(
    "/api/zk/deposits/sign",
    limiter,
    requireAuth,
    validateBody(signRequest),
    asyncHandler(async (req, res) => {
      res.json({ signedTxXdr: await gateway.sign(req.user.id, req.body.id, req.body.xdr) });
    })
  );

  return router;
}
