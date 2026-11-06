import { Router } from "express";
import { asyncHandler } from "../../http/errors.js";
import { validateBody } from "../../http/validate.js";
import { transferRequest, withdrawRequest } from "../../http/schemas.js";

export function createRelayerRouter({ service, monitor, paymentLimiter, checkLimiter, requirePaymentApproval }) {
  const router = Router();
  const spend = (path, schema, run) =>
    router.post(
      path,
      paymentLimiter,
      requirePaymentApproval,
      validateBody(schema),
      asyncHandler(async (req, res) => {
        const { hash, ledger } = await run(req.body, req.user);
        res.status(200).json({ success: true, hash, ledger });
      })
    );

  spend("/api/relayer/transfer", transferRequest, service.transfer);
  spend("/api/relayer/withdraw", withdrawRequest, service.withdraw);

  router.get(
    "/api/relayer/health",
    asyncHandler(async (req, res) => {
      const health = await monitor.health();
      res.status(health.status === "unavailable" ? 503 : 200).json(health);
    })
  );

  router.get("/api/relayer/daemon/status", (req, res) => {
    res.json(monitor.publicStatus());
  });

  // Public, but limited: each call queries the network.
  router.post(
    "/api/relayer/daemon/check-now",
    checkLimiter,
    asyncHandler(async (req, res) => {
      res.json(await monitor.checkNow());
    })
  );

  return router;
}
