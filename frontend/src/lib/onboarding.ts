/**
 * Onboarding ("Get started") progress, shared by the Dashboard checklist and the sidebar.
 * The Dashboard works the steps out from real activity and saves the result here, per
 * user, so every page's sidebar can show it without reloading balances.
 */

export type OnboardingProgress = { done: number; total: number };

const EVENT = "starlit:onboarding";
const progressKey = (userId: string) => `starlit_onboarding_progress_${userId}`;
const collapsedKey = (userId: string) => `starlit_onboarding_done_${userId}`;

export function readProgress(userId: string): OnboardingProgress | null {
  try {
    const value = JSON.parse(localStorage.getItem(progressKey(userId)) || "null") as OnboardingProgress | null;
    return value && Number.isFinite(value.done) && Number.isFinite(value.total) ? value : null;
  } catch {
    return null;
  }
}

export function saveProgress(userId: string, progress: OnboardingProgress) {
  const previous = readProgress(userId);
  if (previous?.done === progress.done && previous.total === progress.total) return;
  try {
    localStorage.setItem(progressKey(userId), JSON.stringify(progress));
  } catch {
    /* storage unavailable: the sidebar just won't show progress */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The checklist was shrunk to its slim bar. */
export function readCollapsed(userId: string): boolean {
  try {
    return localStorage.getItem(collapsedKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function setCollapsed(userId: string, collapsed: boolean) {
  try {
    if (collapsed) localStorage.setItem(collapsedKey(userId), "1");
    else localStorage.removeItem(collapsedKey(userId));
  } catch {
    /* storage unavailable: it resets next visit */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Re-runs `listener` whenever progress or the collapsed state changes, here or in another tab. */
export function onOnboardingChange(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith("starlit_onboarding_")) listener();
  };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
