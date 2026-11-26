// Private payments (shielded transfers and withdrawals) are submitted only by
// the Starlit relayer, so the relayer endpoints are where payment approval is
// enforced: the request must come from a signed-in user who confirmed with
// their passkey or PIN in the last few minutes (the session's fresh-auth
// window). The confirmation in the app alone could be skipped by a script
// running in an unlocked browser; this check cannot.

export function createPaymentApproval({ sessions }) {
  return async function requirePaymentApproval(req, res, next) {
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
    // Signed out since this access token was issued (logout, "sign out
    // everywhere", a stolen token detected): no payments, even within its 15 minutes.
    try {
      if (!(await sessions.isActive(result.session))) {
        return res.status(401).json({ error: "You were signed out. Please sign in again.", code: "invalid_session" });
      }
    } catch (err) {
      return next(err);
    }
    req.user = { id: result.session.id };
    next();
  };
}
