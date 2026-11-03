import { Router } from "express";
import { asyncHandler, HttpError } from "../../http/errors.js";
import { validateBody } from "../../http/validate.js";
import { loginRequest, profileUpdateRequest, registerRequest } from "./schemas.js";

export function createUsersRouter({ service, requireAuth, provenEmail }) {
  const router = Router();
  const proof = async (req) => (provenEmail ? provenEmail(req) : null);

  router.post(
    "/api/auth/login",
    validateBody(loginRequest),
    asyncHandler(async (req, res) => {
      res.status(200).json(await service.login(req.body, await proof(req)));
    })
  );

  router.post(
    "/api/users/register",
    validateBody(registerRequest),
    asyncHandler(async (req, res) => {
      res.status(201).json({ user: await service.register(req.body, await proof(req)) });
    })
  );

  router.get(
    "/api/users/lookup/:username",
    asyncHandler(async (req, res) => {
      if (/^G[A-Z2-7]{55}$/i.test(req.params.username)) {
        throw new HttpError(400, "Stellar public keys are not valid usernames. Use Withdraw to send to an EOA address.");
      }
      // Lenient on purpose: accounts made before the username rules must stay reachable.
      const name = req.params.username.trim().toLowerCase().replace(/^@/, "");
      if (!name || name.length > 64) throw new HttpError(404, "User not found");
      res.status(200).json({ user: await service.lookup(name) });
    })
  );

  const updateProfile = asyncHandler(async (req, res) => {
    res.status(200).json({ user: await service.updateProfile(req.user.id, req.body) });
  });
  router.patch("/api/users/me", requireAuth, validateBody(profileUpdateRequest), updateProfile);
  router.patch("/api/users/profile", requireAuth, validateBody(profileUpdateRequest), updateProfile);

  return router;
}
