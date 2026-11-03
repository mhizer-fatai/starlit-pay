import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../http/errors.js";
import { validateBody } from "../../http/validate.js";

export const createLinkRequest = z.object({
  creator_id: z.string().min(1).max(64),
  // Stored as text with at most 7 decimals, like a Stellar amount.
  amount: z
    .union([z.number(), z.string()])
    .transform(String)
    .pipe(z.string().regex(/^\d+(\.\d{1,7})?$/, "expected an amount").refine((v) => Number(v) > 0, "must be positive")),
  asset: z.enum(["XLM", "USDC"]).optional(),
  commitment: z.string().regex(/^[0-9a-fA-F]{16,128}$/, "expected hex"),
  description: z.string().trim().max(280).optional(),
});

export function createPaymentLinksRouter({ service, requireAuth, currentUser }) {
  const router = Router();

  router.post(
    "/api/payment-links",
    requireAuth,
    validateBody(createLinkRequest),
    asyncHandler(async (req, res) => {
      res.status(201).json({ link: await service.create(req.user, req.body) });
    })
  );

  router.get(
    "/api/payment-links/:commitment",
    asyncHandler(async (req, res) => {
      res.status(200).json({ link: await service.get(req.params.commitment) });
    })
  );

  // Public: someone paying a link from an outside wallet has no Starlit account.
  router.post(
    "/api/payment-links/:commitment/claim",
    asyncHandler(async (req, res) => {
      const txHash = req.body?.txHash;
      const link = await service.claim(req.params.commitment, txHash, currentUser(req));
      res.status(200).json({ status: "ok", link, txHash });
    })
  );

  return router;
}
