import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../../http/errors.js";
import { validateBody } from "../../http/validate.js";

const leaseId = z.string().uuid();
const signRequest = z.object({
  xdr: z.string().min(1).max(32_768).regex(/^[A-Za-z0-9+/=]+$/, "expected base64 XDR"),
  leaseId: leaseId.nullish(),
});
const releaseRequest = z.object({ leaseId });

export function createZkRelayerRouter({ relayer, requireAuth, requirePaymentApproval, limiter }) {
  const router = Router();
  const holder = (req) => req.user?.id ?? req.session?.id;

  // The SDK needs the relayer's address before it builds a transaction.
  router.get("/api/zk/relayer", requireAuth, (req, res) => {
    if (!relayer.address) throw new HttpError(503, "Private payments are not configured.");
    res.json({ address: relayer.address });
  });

  // A channel for this user's next payment (the relayer itself without channels).
  // Not rate-limited like signing: a user only ever holds one channel at a time.
  router.post(
    "/api/zk/relayer/lease",
    requirePaymentApproval,
    asyncHandler(async (req, res) => {
      res.json(await relayer.lease(holder(req)));
    })
  );

  router.post(
    "/api/zk/relayer/sign",
    limiter,
    requirePaymentApproval,
    validateBody(signRequest),
    asyncHandler(async (req, res) => {
      res.json({ signedTxXdr: await relayer.sign(req.body.xdr, holder(req), req.body.leaseId ?? null) });
    })
  );

  // The payment finished (or gave up): the channel can go to someone else.
  router.post(
    "/api/zk/relayer/release",
    requireAuth,
    validateBody(releaseRequest),
    asyncHandler(async (req, res) => {
      await relayer.release(req.body.leaseId, holder(req));
      res.json({ released: true });
    })
  );

  return router;
}
