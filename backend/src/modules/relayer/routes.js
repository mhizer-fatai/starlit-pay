import { Router } from "express";
import { asyncHandler } from "../../http/errors.js";

// The relayer account pays network fees for private payments (as the ZK
// payer) and smart-wallet actions. These routes report its gas balance.
export function createRelayerRouter({ monitor, checkLimiter }) {
  const router = Router();

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
