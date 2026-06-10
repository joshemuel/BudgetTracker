import {
  CHAT_LOGGED_EVENT,
  CHAT_PREFILL_EVENT,
  TX_DELETED_EVENT,
  TX_EDITED_EVENT,
} from "@/lib/tutorial";
import type { LionPose } from "./Lion";

export type TourControls = {
  openQuickLog: () => void;
  closeQuickLog: () => void;
  openChat: () => void;
  closeChat: () => void;
  navigate: (to: string) => void;
  isMobile: boolean;
};

export type TourStep = {
  id: string;
  /** Route this step lives on; the tour navigates there if needed. */
  route?: string;
  /** data-tutorial attribute value. Omit → centered card, no spotlight.
   *  A missing/never-appearing target also falls back to the centered card. */
  target?: string;
  /** Title in Fraunces display; *word* renders italic in accent. */
  title: string;
  /** Static copy, or a function when the wording depends on the device. */
  body: string | ((ctx: TourControls) => string);
  pose?: LionPose;
  /** Extra px of breathing room around the spotlight hole (default 8). */
  padding?: number;
  /** The user drives the page through the spotlight: the scrim drops below
   *  the app's modals, clicks pass through the hole, and the tour stops
   *  intercepting keys (except Escape). */
  interactive?: boolean;
  /** Hide Next; the step only advances via advanceOn (or Back/skip). */
  gated?: boolean;
  /** Layer the card under the app's modals (z-50/70): for exercises that open
   *  a dialog mid-step — the instruction is read before it opens, and the
   *  dialog must stay operable over the card. */
  cardBehindModals?: boolean;
  /** Small-caps hint shown in place of the Next button on gated steps. */
  gateHint?: string;
  /** Window event name that advances to the next step when dispatched. */
  advanceOn?: string;
  /** Include the step only when this returns true (e.g. desktop-only). */
  when?: (isMobile: boolean) => boolean;
  /** Desktop card placement override: beside the spotlight, vertically
   *  centered on it, instead of the below/above auto-flow. Falls back to
   *  auto when the requested side doesn't fit the viewport. */
  desktopPlacement?: "left" | "right";
  /** Mobile: hug the spotlight (adjacent, roomier side) instead of the
   *  centered default — for targets whose surroundings must stay visible. */
  mobilePlacement?: "nearTarget";
  /** Prep on entering the step (open a modal, …). */
  before?: (ctx: TourControls) => void;
  /** Cleanup on leaving the step: dir is +1 advancing, -1 going back,
   *  0 on skip/finish. Lets consecutive steps share state (an open chat)
   *  without a close/reopen flicker between them. */
  after?: (ctx: TourControls, dir?: 1 | -1 | 0) => void;
};

export const PRACTICE_ENTRY_TEXT = "Bought coffee for 50k";

export const tourSteps: TourStep[] = [
  {
    id: "welcome",
    route: "/",
    title: "Welcome to the *ledger*",
    body:
      "I'm Leo — I keep the books around here. Give me two minutes and I'll " +
      "walk you through how everything works. You can skip out at any time.",
    pose: "wave",
  },
  {
    id: "nav-intro",
    target: "nav-panel",
    title: "Four *rooms*",
    body:
      "Everything in the house lives behind one of these four tabs. Let's " +
      "take the quick pass — one room at a time.",
    desktopPlacement: "right",
  },
  {
    id: "nav-overview",
    route: "/",
    target: "nav-overview",
    title: "The *Overview*",
    body:
      "Home base. The radar maps this month against last, the weekly note is " +
      "my written summary, and By Category tracks each budget's pace. The " +
      "credit panel keeps the statement math: carried over + paid − charges " +
      "= outstanding.",
    desktopPlacement: "right",
  },
  {
    id: "nav-activity",
    route: "/monthly",
    target: "nav-activity",
    title: "The *long* view",
    body:
      "Activity stacks a year of bars — click any month and I'll cut it into " +
      "a category pie. The Daily tab adds the heatmap and projects where the " +
      "month will land at this pace.",
    desktopPlacement: "right",
  },
  {
    id: "nav-ledger",
    route: "/transactions",
    target: "nav-ledger",
    title: "Every line *item*",
    body:
      "The ledger itself. Every entry you log lands here — search it, filter " +
      "it, fix it. We'll come back in a minute to practice.",
    desktopPlacement: "right",
  },
  {
    id: "nav-manage",
    route: "/budgets",
    target: "nav-manage",
    title: "The *back* office",
    body:
      "Budgets, subscriptions, wallets, categories, and your account — " +
      "everything you set once and tune occasionally. Let's set up your " +
      "books next.",
    desktopPlacement: "right",
  },
  {
    id: "tracking-mode",
    route: "/settings/account",
    target: "tracking-mode",
    title: "Two ways to *count*",
    body:
      "First decision: track each wallet and card by name, or lump everything " +
      "together by currency. You can switch any time right here — I'll " +
      "re-tally the books either way.",
  },
  {
    id: "wallets-currencies",
    route: "/settings",
    target: "add-source-form",
    title: "Wallets, cards & *currencies*",
    body:
      "Add each wallet, account, or card here with its current funds — and " +
      "tick “Credit card” for the plastic. Every currency you use gets a row " +
      "in the Currencies table above. Then under Account → Defaults, pick a " +
      "home currency and the wallet I should assume when an entry doesn't " +
      "name one.",
  },
  {
    id: "new-entry",
    target: "new-entry",
    title: "The fastest *pen*",
    body:
      "This button — or the N key on a keyboard — opens a fresh entry from " +
      "anywhere in the app.",
  },
  {
    id: "quicklog",
    target: "quicklog-card",
    title: "Log it by *hand*",
    body:
      "Pick a kind, type the amount, choose a category and source, and add a " +
      "note if the money has a story. Then commit it to the ledger.",
    padding: 4,
    before: (ctx) => ctx.openQuickLog(),
    after: (ctx) => ctx.closeQuickLog(),
  },
  {
    id: "chat-access",
    target: "chat-launcher",
    title: "Where to *find* me",
    body: (ctx) =>
      ctx.isMobile
        ? "Prefer plain words to forms? This button opens our chat — I'm one " +
          "tap away from any page."
        : "Prefer plain words to forms? The Chat tab opens our conversation " +
          "across the whole screen — ask anything, log anything.",
    desktopPlacement: "right",
  },
  {
    id: "chat-dock",
    target: "chat-dock",
    title: "Always *listening*",
    body:
      "This docked bar is me too, on every page. Type straight into it and " +
      "hit enter, or click it open for the compact panel — same conversation, " +
      "smaller window.",
    when: (isMobile) => !isMobile,
  },
  {
    id: "chat-log",
    target: "chat-footer",
    title: "Now *you* try",
    body:
      "I've drafted a message for you — just hit send. I'll read it, file " +
      "the entry, category and all. The mic works the same way: talk, tap " +
      "stop, and I'll transcribe and book it.",
    pose: "listen",
    interactive: true,
    gated: true,
    gateHint: "Send the message to continue",
    advanceOn: CHAT_LOGGED_EVENT,
    desktopPlacement: "left",
    mobilePlacement: "nearTarget",
    before: (ctx) => {
      ctx.openChat();
      window.dispatchEvent(
        new CustomEvent(CHAT_PREFILL_EVENT, { detail: PRACTICE_ENTRY_TEXT }),
      );
    },
    // Keep the chat open while advancing into chat-reply — close only on
    // Back or skip/finish.
    after: (ctx, dir) => {
      if (dir !== 1) ctx.closeChat();
    },
  },
  {
    id: "chat-reply",
    target: "chat-reply",
    title: "Signed and *filed*",
    body:
      "That reply is my receipt — the coffee is on the books, category and " +
      "all. If I ever misread you, say so in the next message and I'll " +
      "correct the entry.",
    pose: "cheer",
    desktopPlacement: "left",
    before: (ctx) => ctx.openChat(),
    // Going Back returns to the send exercise — leave the chat open for it.
    after: (ctx, dir) => {
      if (dir !== -1) ctx.closeChat();
    },
  },
  {
    id: "tx-edit",
    route: "/transactions",
    target: "tx-row",
    title: "Fix the *record*",
    body: (ctx) =>
      "There's your coffee, top of the ledger. " +
      (ctx.isMobile
        ? "Tap the entry to open it, hit Edit, change something — the amount, " +
          "the note — and save."
        : "Hit edit on the row, change something — the amount, the note — " +
          "and save."),
    interactive: true,
    gated: true,
    gateHint: "Edit the entry to continue",
    advanceOn: TX_EDITED_EVENT,
    cardBehindModals: true,
  },
  {
    id: "tx-delete",
    target: "tx-row",
    title: "Strike it *out*",
    body:
      "Practice coffee doesn't belong on the books. Delete the same entry " +
      "and confirm — entries are soft-deleted, so the reports forget them " +
      "instantly.",
    interactive: true,
    gated: true,
    gateHint: "Delete the entry to continue",
    advanceOn: TX_DELETED_EVENT,
    cardBehindModals: true,
  },
  {
    id: "budgets",
    route: "/budgets",
    target: "budget-form",
    title: "Draw your *limits*",
    body:
      "Set a monthly limit per category here. I'll keep score against the " +
      "pace of the month and flag the categories running hot.",
  },
  {
    id: "subscriptions",
    route: "/subscriptions",
    target: "subs-books",
    title: "The *recurring* suspects",
    body:
      "Rent, streaming, gym — put them on the books once. When a charge comes " +
      "due I'll raise it at the top of this page and wait for your confirm or " +
      "skip.",
  },
  {
    id: "telegram-finale",
    route: "/settings/account",
    target: "connect-telegram",
    title: "Take me *with* you",
    body:
      "Connect Telegram and log by text or voice note from anywhere — same " +
      "ledger, same rules. One last thing: the masthead has night mode, an " +
      "eye to hide your amounts, and Install for your phone. That's the tour " +
      "— go log something.",
    pose: "cheer",
  },
];
