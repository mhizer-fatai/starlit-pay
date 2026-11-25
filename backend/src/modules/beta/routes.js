import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../../http/errors.js";
import { validateBody } from "../../http/validate.js";

const handle = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v.replace(/^@/, ""))
    .optional();

export const PERSONAS = ["freelancer", "business", "crypto", "developer", "other"];

export const applyRequest = z.object({
  name: z.string().trim().min(1, "is required").max(100),
  // Beta sign-in is Google only, and an approved email signs up with no code.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email().max(254))
    .refine((v) => /@(gmail|googlemail)\.com$/.test(v), "must be the Gmail address you'll sign in with"),
  x_handle: handle(32),
  telegram_handle: handle(64),
  persona: z.enum(PERSONAS),
  reason: z.string().trim().min(3, "is too short").max(500, "is too long"),
  captchaToken: z.string().max(4096).optional(),
});

export const groupInviteRequest = z.object({
  label: z.string().trim().min(1, "is required").max(100),
  maxUses: z.number().int().min(1).max(1000),
});

export function createBetaRouter({ service, requireAuth, provenEmail = null }) {
  const router = Router();

  const requireAdmin = (req, _res, next) => {
    if (!service.isAdmin(req.user?.email)) return next(new HttpError(403, "Admins only."));
    next();
  };

  router.get(
    "/api/beta/config",
    asyncHandler(async (_req, res) => {
      res.status(200).json({ inviteOnly: service.inviteOnly });
    })
  );

  // Sign-up asks this after Google sign-in: only the email's owner can ask.
  router.get(
    "/api/beta/access",
    asyncHandler(async (req, res) => {
      const email = provenEmail ? await provenEmail(req) : null;
      res.status(200).json({ inviteOnly: service.inviteOnly, approved: email ? await service.isApproved(email) : false });
    })
  );

  router.post(
    "/api/beta/apply",
    validateBody(applyRequest),
    asyncHandler(async (req, res) => {
      const { captchaToken, ...input } = req.body;
      res.status(200).json(await service.apply(input, captchaToken));
    })
  );

  router.get(
    "/api/beta/status/:token",
    asyncHandler(async (req, res) => {
      if (!/^[A-Za-z0-9_-]{20,64}$/.test(req.params.token)) throw new HttpError(404, "We couldn't find that application.");
      res.status(200).json(await service.status(req.params.token));
    })
  );

  router.get(
    "/api/beta/me",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.status(200).json({ admin: service.isAdmin(req.user.email), tickets: await service.goldenTickets(req.user.id) });
    })
  );

  // --- Admin -----------------------------------------------------------------

  router.get(
    "/api/beta/admin/applications",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : undefined;
      const [applications, counts] = await Promise.all([service.listApplications(status), service.applicationCounts()]);
      res.status(200).json({ applications, counts });
    })
  );

  router.post(
    "/api/beta/admin/applications/approve-all",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      res.status(200).json(await service.approveAll());
    })
  );

  router.post(
    "/api/beta/admin/applications/:id/approve",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      res.status(200).json(await service.approve(req.params.id));
    })
  );

  router.post(
    "/api/beta/admin/applications/:id/reject",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      res.status(200).json({ application: await service.reject(req.params.id) });
    })
  );

  router.get(
    "/api/beta/admin/invites",
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req, res) => {
      res.status(200).json({ invites: await service.listGroupInvites() });
    })
  );

  router.post(
    "/api/beta/admin/invites",
    requireAuth,
    requireAdmin,
    validateBody(groupInviteRequest),
    asyncHandler(async (req, res) => {
      res.status(201).json({ invite: await service.createGroupInvite(req.body) });
    })
  );

  router.post(
    "/api/beta/admin/invites/:code/revoke",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      await service.revoke(req.params.code);
      res.status(200).json({ ok: true });
    })
  );

  return router;
}
