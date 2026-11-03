import { authLayer } from "../auth_layer/mount.js";

/** The signed-in user, or null: for routes open to everyone that treat members differently. */
export function sessionUser(req) {
  const session = authLayer.sessions?.authenticate(req)?.session;
  return session ? { id: session.id, email: session.email, username: session.username } : null;
}

/** Authentication middleware: a passkey-layer session (access cookie or Bearer access token). */
export function requireAuth(req, res, next) {
  const result = authLayer.sessions?.authenticate(req);
  if (result?.session) {
    req.session = result.session;
    req.user = { id: result.session.id, email: result.session.email, username: result.session.username };
    return next();
  }
  if (result?.error === "csrf") {
    return res.status(403).json({ error: "Missing CSRF header.", code: "csrf" });
  }
  return res.status(401).json({ error: "Unauthorized: Missing or invalid authentication token." });
}

/**
 * The Google-verified email of the caller (X-Supabase-Auth header), or null.
 * Itself null when passkey auth is not configured (local development).
 */
export const provenEmail = authLayer.provenEmail ?? null;
