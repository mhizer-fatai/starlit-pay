import { Router } from "express";
import { asyncHandler } from "../../http/errors.js";
import { validateBody } from "../../http/validate.js";
import { postNoteRequest, spendNoteRequest } from "../../http/schemas.js";

export function createNotesRouter({ service, requireAuth, currentUser, postLimiter }) {
  const router = Router();
  const sessionUserId = (req) => currentUser(req)?.id ?? null;

  router.get(
    "/api/notes/:viewingKey",
    asyncHandler(async (req, res) => {
      const { timestamp, signature, include } = req.query;
      const notes = await service.list(req.params.viewingKey, sessionUserId(req), { timestamp, signature, includeSpent: include === "spent" });
      res.status(200).json({ notes });
    })
  );

  // Signed-in only: an open endpoint let anyone drop a fake "incoming payment"
  // into any wallet.
  router.post(
    "/api/notes",
    requireAuth,
    postLimiter,
    validateBody(postNoteRequest),
    asyncHandler(async (req, res) => {
      res.status(201).json({ note: await service.add(req.body) });
    })
  );

  router.post(
    "/api/notes/spend",
    validateBody(spendNoteRequest),
    asyncHandler(async (req, res) => {
      const { commitment, timestamp, signature } = req.body;
      res.status(200).json(await service.markSpent(commitment, sessionUserId(req), { timestamp, signature }));
    })
  );

  return router;
}
