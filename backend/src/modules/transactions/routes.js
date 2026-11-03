import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../http/errors.js";
import { validateBody } from "../../http/validate.js";

// The size limit is the service's (413), not a validation error.
const recordRequest = z.object({ user_id: z.string().min(1).max(64), encrypted_payload: z.string().min(1) });

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
    validateBody(recordRequest),
    asyncHandler(async (req, res) => {
      res.status(201).json({ transaction: await service.record(req.user, req.body) });
    })
  );

  return router;
}
