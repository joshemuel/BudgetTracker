// Leo's tour: per-user "seen it" flag + a window event to replay it on demand.
// Mirrors the bt_* localStorage + CustomEvent pattern in theme.ts / privacy.ts.

const DONE_PREFIX = "bt_tutorial_done_";
export const TUTORIAL_START_EVENT = "bt-tutorial-start";

export function isTutorialDone(userId: number): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(`${DONE_PREFIX}${userId}`) === "1";
}

export function markTutorialDone(userId: number): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(`${DONE_PREFIX}${userId}`, "1");
}

export function startTutorial(): void {
  window.dispatchEvent(new CustomEvent(TUTORIAL_START_EVENT));
}
