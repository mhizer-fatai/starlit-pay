import express from "express";
import cookieParser from "cookie-parser";
import { readAuthSettings } from "./settings.js";
import { createSessionService } from "./sessions.js";
import { registerPasskeyRoutes } from "./passkeys.js";
import { registerVaultRoutes } from "./vault.js";
import { provenEmail, safeUser } from "./identity.js";
import { noAlerts } from "./alerts.js";

/** Express 4 ignores rejected promises; route them to the error handler instead. */
function catchAsync(router) {
  for (const method of ["get", "post", "put", "delete"]) {
    const register = router[method].bind(router);
    router[method] = (path, ...handlers) =>
      register(
        path,
        ...handlers.map((handler) => (req, res, next) => {
          try {
            const result = handler(req, res, next);
            if (result && typeof result.catch === "function") result.catch(next);
          } catch (err) {
            next(err);
          }
        })
      );
  }
  return router;
}

const LAYER_PATHS = [
  "/api/auth/passkey",
  "/api/auth/passkeys",
  "/api/auth/session",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/vault",
];

/**
 * Builds the passkey auth layer: WebAuthn ceremonies, cookie sessions, the key
 * vault and PIN limiter. Returns an Express router plus the session service so
 * existing routes can accept the new sessions.
 */
export function createAuthLayer({ store, identity, alerts = noAlerts, env = process.env, settings: overrides = {} }) {
  const settings = { ...readAuthSettings(env), ...overrides };
  const router = catchAsync(express.Router());
  router.use(LAYER_PATHS, express.json({ limit: "64kb" }), cookieParser());

  if (!settings.configured) {
    router.use(LAYER_PATHS, (req, res) =>
      res.status(503).json({ error: "Passkey sign-in is not configured on this server.", code: "auth_not_configured" })
    );
    return { router, settings, sessions: null };
  }

  const sessions = createSessionService({ store, settings });
  const deps = { store, sessions, identity, settings, alerts };

  router.get("/api/auth/session", sessions.requireSession, async (req, res) => {
    const user = await store.findUserById(req.session.id);
    if (!user) return res.status(401).json({ error: "Session expired.", code: "invalid_session" });
    res.json({
      user: safeUser(user),
      amr: req.session.amr,
      authTime: req.session.auth_time,
      fresh: sessions.isFresh(req.session),
    });
  });
  router.post("/api/auth/refresh", sessions.refresh);
  router.post("/api/auth/logout", sessions.logout);

  registerPasskeyRoutes(router, deps);
  registerVaultRoutes(router, deps);

  // Async handler errors: log server-side, never leak details to the client.
  router.use(LAYER_PATHS, (err, req, res, _next) => {
    console.error(`[AUTH-LAYER] ${req.method} ${req.path} failed: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ error: "Something went wrong. Please try again." });
  });

  return { router, settings, sessions, provenEmail: (req) => provenEmail(identity, req) };
}
