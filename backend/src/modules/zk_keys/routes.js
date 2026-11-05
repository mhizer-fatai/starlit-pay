import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../../http/errors.js";
import { validateBody } from "../../http/validate.js";

const fieldKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected 0x and 32 bytes of hex");
export const publishKeysRequest = z.object({
  noteKey: fieldKey,
  encryptionKey: fieldKey,
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/, "expected a base64 ed25519 signature"),
});

export function createZkKeysRouter({ service, requireAuth }) {
  const router = Router();

  router.put(
    "/api/zk/keys",
    requireAuth,
    validateBody(publishKeysRequest),
    asyncHandler(async (req, res) => {
      res.status(200).json({ keys: await service.publish(req.user.id, req.body) });
    })
  );

  router.get(
    "/api/zk/keys/:username",
    requireAuth,
    asyncHandler(async (req, res) => {
      const name = req.params.username.trim().toLowerCase().replace(/^@/, "");
      if (!name || name.length > 64) throw new HttpError(404, "User not found");
      res.status(200).json({ keys: await service.lookup(name) });
    })
  );

  return router;
}
