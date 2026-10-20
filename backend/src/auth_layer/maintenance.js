// Periodic cleanup for the auth layer: unused WebAuthn challenges past their
// expiry, and refresh-token rows past theirs. Consumed refresh tokens are kept
// until they expire, because a reused consumed token is how theft is detected.

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // hourly
const SESSION_GRACE_MS = 24 * 60 * 60 * 1000;

export async function purgeExpired(store, nowMs) {
  const challenges = await store.purgeExpiredChallenges(new Date(nowMs).toISOString());
  const sessions = await store.purgeExpiredSessions(new Date(nowMs - SESSION_GRACE_MS).toISOString());
  return { challenges, sessions };
}

export function startAuthMaintenance(store, { now = () => Date.now(), intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  const run = async () => {
    try {
      const removed = await purgeExpired(store, now());
      if (removed.challenges || removed.sessions) {
        console.log(`[AUTH-MAINTENANCE] Purged ${removed.challenges} expired challenges, ${removed.sessions} expired sessions.`);
      }
    } catch (err) {
      console.error(`[AUTH-MAINTENANCE] Cleanup failed: ${err.message}`);
    }
  };
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
