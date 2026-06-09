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
  body: string;
  pose?: LionPose;
  /** Extra px of breathing room around the spotlight hole (default 8). */
  padding?: number;
  /** Prep on entering the step (open a modal, …). */
  before?: (ctx: TourControls) => void;
  /** Cleanup on leaving the step in either direction, and on skip/finish. */
  after?: (ctx: TourControls) => void;
};

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
      "in the Currencies table above, with its own balance and default source.",
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
    id: "chat",
    target: "chat-footer",
    title: "Or just *tell* me",
    body:
      "Type plain words — “coffee 25k yesterday” — and I'll file the entry, " +
      "category and all. Or tap the mic, talk, and tap stop: I'll transcribe " +
      "the voice note and book it the same way.",
    pose: "listen",
    before: (ctx) => ctx.openChat(),
    after: (ctx) => ctx.closeChat(),
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
    id: "defaults",
    route: "/settings/account",
    target: "prefs-defaults",
    title: "Your *defaults*",
    body:
      "Pick a home currency, and the wallet I should assume when an entry " +
      "doesn't name one. Less typing for you, fewer questions from me.",
  },
  {
    id: "credit",
    route: "/",
    target: "credit-panel",
    title: "How *credit* works",
    body:
      "Credit cards don't dent your cash until you pay the bill. I keep the " +
      "statement math for you: carried over + paid − charges = outstanding.",
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
    id: "graphs-overview",
    route: "/",
    target: "radar",
    title: "Your month at a *glance*",
    body:
      "The radar maps where this month went against last; the weekly note is " +
      "my written summary; and By Category tracks each budget's pace.",
    pose: "cheer",
  },
  {
    id: "graphs-activity",
    route: "/monthly",
    target: "monthly-chart",
    title: "The *long* view",
    body:
      "A year of stacked bars — click any month and I'll cut it into a " +
      "category pie. The Daily tab adds the heatmap and projects where the " +
      "month will land at this pace.",
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
