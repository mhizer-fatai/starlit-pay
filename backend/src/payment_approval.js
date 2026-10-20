import jwt from "jsonwebtoken";

// Private payments (shielded transfers and withdrawals) are submitted only by
// the Starlit relayer, so the relayer endpoints are where payment approval is
// enforced: the request must come from a signed-in user who confirmed with
// their passkey or PIN in the last few minutes (the session's fresh-auth
// window). The confirmation in the app alone could be skipped by a script
// running in an unlocked browser; this check cannot.
//
// Legacy accounts (pre-passkey JWT) have no confirmation ceremony; they are
// upgraded at sign-in and accepted here until that path is removed.

export function createPaymentApproval({ sessions, jwtSecret }) {
  function legacyUserId(req) {
    const header = req.headers.authorization;
    if (!jwtSecret || !header?.startsWith("Bearer ")) return null;
    try {
      const decoded = jwt.verify(header.slice(7), jwtSecret, { algorithms: ["HS256"] });
      return decoded?.id ?? null;
    } catch {
      return null; // not a legacy token; it may be a passkey session token
    }
  }

  return function requirePaymentApproval(req, res, next) {
    const legacyId = legacyUserId(req);
    if (legacyId) {
      req.user = { id: legacyId };
      return next();
    }
    const result = sessions?.authenticate(req);
    if (!result) return res.status(401).json({ error: "Sign in to send payments.", code: "no_session" });
    if (result.error === "csrf") return res.status(403).json({ error: "Missing CSRF header.", code: "csrf" });
    if (result.error) return res.status(401).json({ error: "Your session expired. Sign in again.", code: "invalid_session" });
    if (!sessions.isFresh(result.session)) {
      return res.status(401).json({
        error: "Please confirm this payment with your passkey or PIN.",
        code: "reauth_required",
      });
    }
    req.user = { id: result.session.id };
    next();
  };
}
