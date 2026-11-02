import { Router } from "express";
import { asyncHandler, errorMiddleware } from "../../http/errors.js";

export function createTransactionsRouter({ service, requireAuth }) {
  const router = Router();

  router.get(
    "/api/transactions/:userId",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.status(200).json({ transactions: await service.list(req.user, req.params.userId) });
    })
  );

  router.post(
    "/api/transactions",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.status(201).json({ transaction: await service.record(req.user, req.body) });
    })
  );

  router.use("/api/transactions", errorMiddleware);
  return router;
}
