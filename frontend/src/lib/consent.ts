export interface ConsentState {
  /** Strictly necessary technologies are always on and cannot be disabled. */
  necessary: true;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
  decidedAt?: string;
}

const KEY = "starlit_cookie_consent";

export const DEFAULT_CONSENT: ConsentState = {
  necessary: true,
  functional: true,
  analytics: false,
  marketing: false,
};

/** Reads the stored preference, or null when the user has never chosen. */
export function getConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    return {
      necessary: true,
      functional: parsed.functional ?? DEFAULT_CONSENT.functional,
      analytics: parsed.analytics ?? DEFAULT_CONSENT.analytics,
      marketing: parsed.marketing ?? DEFAULT_CONSENT.marketing,
      decidedAt: parsed.decidedAt,
    };
  } catch {
    return null;
  }
}

/** Persists the user's choice (necessary is always true). */
export function setConsent(choice: Omit<ConsentState, "necessary" | "decidedAt">): ConsentState {
  const next: ConsentState = {
    necessary: true,
    ...choice,
    decidedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
