// One session refresh at a time, for the whole app. The access cookie lasts
// 15 minutes and is renewed with the refresh cookie, which works only once:
// two refreshes at the same moment would present the same refresh token
// twice, and the server treats that as theft and signs the user out.

let inFlight: Promise<boolean> | null = null;

/** Runs `refresh` unless one is already running, in which case it waits for that one. */
export function refreshOnce(refresh: () => Promise<boolean>): Promise<boolean> {
  inFlight ??= refresh()
    .catch(() => false)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Answers that mean "the access cookie expired": worth a refresh and one retry. */
export const RETRYABLE_SESSION_CODES = new Set(["no_session", "invalid_session"]);
