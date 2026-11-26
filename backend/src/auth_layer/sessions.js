import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { mac, randomToken } from "./crypto.js";

// Cookie names before the __Host-/__Secure- prefixes; still read (and cleared)
// so sessions from before the rename keep working until they next refresh.
export const ACCESS_COOKIE = "starlit_at";
export const REFRESH_COOKIE = "starlit_rt";
export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "starlit";

const ISSUER = "starlit-auth";
const AUDIENCE = "starlit-api";
const REFRESH_PATH = "/api/auth";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Two tabs refreshing at the same moment present the same refresh token. A
// reuse this soon after it was consumed is that race, not theft: it gets no new
// tokens (the other tab's response already set them in the shared cookie jar),
// and the session is left alone.
export const REFRESH_RACE_GRACE_SEC = 20;

/**
 * Cookie names for these settings. Over HTTPS they carry the browser-enforced
 * prefixes: __Host- (this exact host, path /, no Domain), so no other subdomain
 * can set or overwrite it, and __Secure- for the refresh cookie, which keeps its
 * narrower path.
 */
export function cookieNames({ secure, domain }) {
  if (!secure) return { access: ACCESS_COOKIE, refresh: REFRESH_COOKIE };
  return { access: domain ? `__Secure-${ACCESS_COOKIE}` : `__Host-${ACCESS_COOKIE}`, refresh: `__Secure-${REFRESH_COOKIE}` };
}

/**
 * Session service: a short-lived access JWT plus a rotating, single-use refresh
 * token, both in httpOnly cookies. Reusing a consumed refresh token revokes the
 * whole session family.
 */
export function createSessionService({ store, settings }) {
  const { keys } = settings;
  const nowSec = () => Math.floor(settings.now() / 1000);
  const names = cookieNames(settings.cookie);
  const renamed = names.access !== ACCESS_COOKIE;
  const accessToken = (req) => req.cookies?.[names.access] ?? (renamed ? req.cookies?.[ACCESS_COOKIE] : undefined);
  const refreshToken = (req) => req.cookies?.[names.refresh] ?? (renamed ? req.cookies?.[REFRESH_COOKIE] : undefined);

  function cookieOptions(maxAgeSec, path) {
    return {
      httpOnly: true,
      secure: settings.cookie.secure,
      sameSite: settings.cookie.sameSite,
      domain: settings.cookie.domain,
      path,
      maxAge: maxAgeSec * 1000,
    };
  }

  function signAccess(user, { sid, amr, authTime }) {
    return jwt.sign(
      {
        typ: "access",
        id: user.id,
        email: user.email,
        username: user.username,
        sid,
        amr,
        auth_time: authTime,
        iat: nowSec(),
      },
      keys.accessJwt,
      {
        algorithm: "HS256",
        expiresIn: settings.accessTtlSec,
        issuer: ISSUER,
        audience: AUDIENCE,
        subject: user.id,
      }
    );
  }

  function verifyAccess(token) {
    try {
      const payload = jwt.verify(token, keys.accessJwt, {
        algorithms: ["HS256"],
        issuer: ISSUER,
        audience: AUDIENCE,
        clockTimestamp: nowSec(),
      });
      if (
        payload.typ !== "access" ||
        typeof payload.id !== "string" ||
        typeof payload.sid !== "string" ||
        !Number.isSafeInteger(payload.auth_time) ||
        !Array.isArray(payload.amr)
      ) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  function setAccessCookie(res, user, claims) {
    res.cookie(names.access, signAccess(user, claims), cookieOptions(settings.accessTtlSec, "/"));
    if (renamed) clearLegacyCookies(res);
  }

  /** Starts a new session family and sets both cookies. */
  async function issue(res, user, { amr, passkeyId = null, userAgent = null }) {
    const familyId = crypto.randomUUID();
    const authTime = nowSec();
    await insertRefresh(res, user, { familyId, amr, authTime, passkeyId, userAgent });
    setAccessCookie(res, user, { sid: familyId, amr, authTime });
    return { familyId, authTime };
  }

  async function insertRefresh(res, user, { familyId, amr, authTime, passkeyId, userAgent }) {
    const refreshToken = randomToken();
    await store.insertSession({
      id: crypto.randomUUID(),
      userId: user.id,
      familyId,
      tokenHash: mac(keys.refreshToken, refreshToken),
      amr,
      authTime: new Date(authTime * 1000).toISOString(),
      passkeyId,
      userAgent: userAgent ? String(userAgent).slice(0, 256) : null,
      expiresAt: new Date(settings.now() + settings.refreshTtlSec * 1000).toISOString(),
    });
    res.cookie(names.refresh, refreshToken, cookieOptions(settings.refreshTtlSec, REFRESH_PATH));
  }

  /** Re-signs the access token with a fresh auth_time after a step-up ceremony. */
  function markFresh(res, user, session, method) {
    const amr = Array.from(new Set([...session.amr, method]));
    setAccessCookie(res, user, { sid: session.sid, amr, authTime: nowSec() });
  }

  const cookieBase = () => ({
    httpOnly: true,
    secure: settings.cookie.secure,
    sameSite: settings.cookie.sameSite,
    domain: settings.cookie.domain,
  });

  function clearLegacyCookies(res) {
    res.clearCookie(ACCESS_COOKIE, { ...cookieBase(), path: "/" });
    res.clearCookie(REFRESH_COOKIE, { ...cookieBase(), path: REFRESH_PATH });
  }

  function clearCookies(res) {
    res.clearCookie(names.access, { ...cookieBase(), path: "/" });
    res.clearCookie(names.refresh, { ...cookieBase(), path: REFRESH_PATH });
    if (renamed) clearLegacyCookies(res);
  }

  /**
   * Reads the access token from the Bearer header or the access cookie.
   * Cookie-authenticated unsafe requests must carry the CSRF header.
   * Returns { session } | { error } | null (no credentials).
   */
  function authenticate(req) {
    const header = req.headers.authorization;
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const cookieToken = accessToken(req);
    const token = bearer || cookieToken;
    if (!token) return null;

    const session = verifyAccess(token);
    if (!session) return { error: "invalid" };

    if (!bearer && UNSAFE_METHODS.has(req.method) && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
      return { error: "csrf" };
    }
    return { session };
  }

  function requireSession(req, res, next) {
    const result = authenticate(req);
    if (!result) return res.status(401).json({ error: "Not signed in.", code: "no_session" });
    if (result.error === "csrf") {
      return res.status(403).json({ error: "Missing CSRF header.", code: "csrf" });
    }
    if (result.error) return res.status(401).json({ error: "Session expired.", code: "invalid_session" });
    req.session = result.session;
    req.user = { id: result.session.id, email: result.session.email, username: result.session.username };
    next();
  }

  function isFresh(session) {
    return nowSec() - session.auth_time <= settings.freshAuthSec;
  }

  /**
   * Whether the session has not been signed out (logout, "sign out everywhere",
   * or a detected stolen token). The access JWT alone stays valid for up to 15
   * minutes after that, so money and key actions check this too.
   */
  async function isActive(session) {
    return store.isSessionFamilyActive(session.sid, new Date(settings.now()).toISOString());
  }

  /** Signs the user out of every other session: after a credential changes, a stolen session must stop working. */
  async function endOtherSessions(userId, keepFamilyId) {
    await store.revokeOtherSessions(userId, keepFamilyId ?? null);
  }

  /**
   * Use after requireSession: sensitive actions need an auth ceremony in the
   * last few minutes, on a session that is still live.
   */
  async function requireFreshAuth(req, res, next) {
    if (!req.session || !isFresh(req.session)) {
      return res.status(401).json({
        error: "Please confirm it's you with your passkey or PIN.",
        code: "reauth_required",
      });
    }
    try {
      if (!(await isActive(req.session))) {
        clearCookies(res);
        return res.status(401).json({ error: "You were signed out. Please sign in again.", code: "invalid_session" });
      }
    } catch (err) {
      return next(err);
    }
    next();
  }

  async function refresh(req, res) {
    const token = refreshToken(req);
    if (!token) return res.status(401).json({ error: "Not signed in.", code: "no_session" });

    const tokenHash = mac(keys.refreshToken, token);
    const consumed = await store.consumeSession(tokenHash, new Date(settings.now()).toISOString());

    if (!consumed) {
      // Unknown, expired, revoked, or already used. A second use of a consumed
      // token means it was stolen: revoke every session in that family.
      const existing = await store.findSessionByHash(tokenHash);
      if (existing?.consumed_at && !existing.revoked_at) {
        const sinceSec = (settings.now() - new Date(existing.consumed_at).getTime()) / 1000;
        if (sinceSec <= REFRESH_RACE_GRACE_SEC) {
          // Another tab refreshed a moment ago: its new cookies are already in the jar.
          return res.status(409).json({ error: "Already refreshed in another tab.", code: "refresh_raced" });
        }
        await store.revokeSessionFamily(existing.family_id);
      }
      clearCookies(res);
      return res.status(401).json({ error: "Session expired.", code: "invalid_session" });
    }

    const user = await store.findUserById(consumed.user_id);
    if (!user) {
      clearCookies(res);
      return res.status(401).json({ error: "Session expired.", code: "invalid_session" });
    }

    const authTime = Math.floor(new Date(consumed.auth_time).getTime() / 1000);
    await insertRefresh(res, user, {
      familyId: consumed.family_id,
      amr: consumed.amr,
      authTime,
      passkeyId: consumed.passkey_id,
      userAgent: req.headers["user-agent"],
    });
    setAccessCookie(res, user, { sid: consumed.family_id, amr: consumed.amr, authTime });
    res.json({ ok: true });
  }

  async function logout(req, res) {
    const result = authenticate(req);
    if (result?.session) {
      await store.revokeSessionFamily(result.session.sid);
    } else if (refreshToken(req)) {
      const existing = await store.findSessionByHash(mac(keys.refreshToken, refreshToken(req)));
      if (existing) await store.revokeSessionFamily(existing.family_id);
    }
    clearCookies(res);
    res.json({ ok: true });
  }

  return {
    issue,
    markFresh,
    authenticate,
    requireSession,
    requireFreshAuth,
    isFresh,
    isActive,
    endOtherSessions,
    refresh,
    logout,
    clearCookies,
    verifyAccess,
  };
}
