// One session refresh at a time, for the whole app and across its tabs. The
// access cookie lasts 15 minutes and is renewed with the refresh cookie, which
// works only once. Two refreshes presenting the same refresh token look like a
// stolen token to the server, so:
//  - within a tab, refreshes running at once share one request;
//  - across tabs, a Web Lock makes them take turns, so the second tab sends the
//    new refresh cookie the first one just received (cookies are shared);
//  - should two still collide, the server answers 409 "refresh_raced" to the
//    second, without signing anyone out: the other tab's new cookies are
//    already in place, so that counts as refreshed.

const LOCK_NAME = "starlit-session-refresh";

let inFlight: Promise<boolean> | null = null;

/** Runs `refresh` with the cross-tab lock when the browser has Web Locks. */
async function withTabLock(refresh: () => Promise<boolean>): Promise<boolean> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return refresh();
  // The lock is held until `refresh` settles; its result is passed through.
  return await locks.request(LOCK_NAME, refresh);
}

/** Runs `refresh` unless one is already running, in which case it waits for that one. */
export function refreshOnce(refresh: () => Promise<boolean>): Promise<boolean> {
  inFlight ??= withTabLock(refresh)
    .catch(() => false)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** A refresh answer meaning the session is good: renewed here, or just renewed by another tab. */
export function refreshSucceeded(res: { ok: boolean; status: number }): boolean {
  return res.ok || res.status === 409;
}

/** Answers that mean "the access cookie expired": worth a refresh and one retry. */
export const RETRYABLE_SESSION_CODES = new Set(["no_session", "invalid_session"]);
