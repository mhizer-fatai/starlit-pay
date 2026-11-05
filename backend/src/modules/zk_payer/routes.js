import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../../http/errors.js";
import { validateBody } from "../../http/validate.js";

const signRequest = z.object({ xdr: z.string().min(1).max(32_768).regex(/^[A-Za-z0-9+/=]+$/, "expected base64 XDR") });

export function createZkPayerRouter({ payer, requireAuth, requirePaymentApproval, limiter }) {
  const router = Router();

  // The SDK needs the payer's address before it builds a transaction.
  router.get("/api/zk/payer", requireAuth, (req, res) => {
    if (!payer.address) throw new HttpError(503, "Private payments are not configured.");
    res.json({ address: payer.address });
  });

  router.post(
    "/api/zk/payer/sign",
    limiter,
    requirePaymentApproval,
    validateBody(signRequest),
    asyncHandler(async (req, res) => {
      res.json({ signedTxXdr: await payer.sign(req.body.xdr, req.user?.id ?? req.session?.id) });
    })
  );

  return router;
}
