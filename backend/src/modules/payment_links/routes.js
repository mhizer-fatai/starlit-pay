import { Router } from "express";
import { asyncHandler, errorMiddleware } from "../../http/errors.js";

export function createPaymentLinksRouter({ service, requireAuth, currentUser }) {
  const router = Router();

  router.post(
    "/api/payment-links",
    requireAuth,
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

  router.use("/api/payment-links", errorMiddleware);
  return router;
}
