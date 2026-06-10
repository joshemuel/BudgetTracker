// Leo's tour: per-user "seen it" flag + a window event to replay it on demand.
// Mirrors the bt_* localStorage + CustomEvent pattern in theme.ts / privacy.ts.

const DONE_PREFIX = "bt_tutorial_done_";
export const TUTORIAL_START_EVENT = "bt-tutorial-start";

// Events that drive the tour's interactive exercise. The tour listens for the
// last three (advanceOn) and dispatches the first (chat draft prefill).
export const CHAT_PREFILL_EVENT = "bt-chat-prefill";
export const CHAT_LOGGED_EVENT = "bt-chat-logged";
export const TX_EDITED_EVENT = "bt-tx-edited";
export const TX_DELETED_EVENT = "bt-tx-deleted";

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
