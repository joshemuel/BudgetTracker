import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { Me } from "@/types";
import { monthName } from "@/lib/format";
import { useIsMobile } from "@/lib/mediaQuery";
import { useAmountVisibility } from "@/lib/privacy";
import { usePwaInstall, type InstallPlatform } from "@/lib/pwaInstall";
import { useTheme } from "@/lib/theme";
import { startSyncPolling } from "@/lib/sync";
import { startTutorial } from "@/lib/tutorial";
import QuickLog from "@/components/QuickLog";
import Tour from "@/components/tour/Tour";
import UserPrefsMenu from "@/components/UserPrefsMenu";
import WebChat from "@/components/WebChat";
import { ChatProvider } from "@/components/chat/ChatProvider";

// Single source of truth for navigation. Desktop renders these as a collapsible
// left sidebar (top-level) plus a sub-tab strip (group.sub); mobile renders the
// same groups as the bottom bar (BottomNav) + a segmented sub-nav (GroupSubNav).
type SubLink = { to: string; label: string; end?: boolean };
type NavGroup = {
  key: "overview" | "activity" | "ledger" | "manage";
  label: string;
  to: string; // landing route when the tab is tapped
  routes: string[]; // every route that lights this tab up
  sub?: SubLink[];
};

const navGroups: NavGroup[] = [
  { key: "overview", label: "Overview", to: "/", routes: ["/"] },
  {
    key: "activity",
    label: "Activity",
    to: "/monthly",
    routes: ["/monthly", "/daily"],
    sub: [
      { to: "/monthly", label: "Monthly" },
      { to: "/daily", label: "Daily" },
    ],
  },
  { key: "ledger", label: "Transactions", to: "/transactions", routes: ["/transactions"] },
  {
    key: "manage",
    label: "Manage",
    to: "/budgets",
    routes: ["/budgets", "/subscriptions", "/settings", "/settings/categories", "/settings/account"],
    sub: [
      { to: "/budgets", label: "Budgets" },
      { to: "/subscriptions", label: "Subscriptions" },
      { to: "/settings", label: "Wallets", end: true },
      { to: "/settings/categories", label: "Categories" },
      { to: "/settings/account", label: "Account" },
    ],
  },
];

// Section key for the active route — drives the data-section hue on the shell.
function sectionFor(pathname: string): string {
  if (pathname === "/chat") return "chat";
  return navGroups.find((g) => g.routes.includes(pathname))?.key ?? "overview";
}

// Per-section active styling. Literal class names (not concatenation) so
// Tailwind's scanner emits the wash + edge utilities.
const sectionActiveFill: Record<string, string> = {
  overview: "bg-tab-overview text-tab-overview-edge",
  activity: "bg-tab-activity text-tab-activity-edge",
  ledger: "bg-tab-ledger text-tab-ledger-edge",
  manage: "bg-tab-manage text-tab-manage-edge",
  chat: "bg-tab-chat text-tab-chat-edge",
};

function NavIcon({ name }: { name: NavGroup["key"] }) {
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (name === "overview") {
    // Dashboard bars — echoes the masthead chart mark.
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}>
        <path d="M4 20V11" />
        <path d="M10 20V4" />
        <path d="M16 20v-6" />
        <path d="M21 20H3" />
      </svg>
    );
  }
  if (name === "activity") {
    // Calendar — Monthly + Daily.
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}>
        <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
        <path d="M3 9.5h18" />
        <path d="M8 2.5v4" />
        <path d="M16 2.5v4" />
      </svg>
    );
  }
  if (name === "ledger") {
    // Receipt — Transactions.
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}>
        <path d="M5 3h14v18l-2.6-1.6L14 21l-2-1.4L10 21l-2.4-1.6L5 21V3Z" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
      </svg>
    );
  }
  // Sliders — Subscriptions + Budgets + Settings.
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}>
      <path d="M4 7h8" />
      <path d="M17 7h3" />
      <circle cx="14.5" cy="7" r="2" />
      <path d="M4 17h3" />
      <path d="M12 17h8" />
      <circle cx="9.5" cy="17" r="2" />
    </svg>
  );
}

function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav
      className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur-md border-t border-paper-rule"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      data-tutorial="nav-panel"
    >
      <ul className="grid grid-cols-4 px-1.5 pt-1.5">
        {navGroups.map((g) => {
          const active = g.routes.includes(pathname);
          return (
            <li key={g.key}>
              <Link
                to={g.to}
                aria-current={active ? "page" : undefined}
                data-tutorial={`nav-${g.key}`}
                className={
                  "flex flex-col items-center justify-center gap-1 min-h-[52px] mx-0.5 rounded-2xl transition-all duration-150 active:scale-95 " +
                  (active ? sectionActiveFill[g.key] : "text-ink-mute active:text-ink")
                }
              >
                <NavIcon name={g.key} />
                <span className="smallcaps leading-none" style={{ fontSize: "9px" }}>
                  {g.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function GroupSubNav() {
  const { pathname } = useLocation();
  const group = navGroups.find((g) => g.routes.includes(pathname));
  if (!group?.sub) return null;
  const activeFill = sectionActiveFill[group.key];
  return (
    <nav className="sm:hidden pt-3 pb-1 overflow-x-auto -mx-3 px-3">
      {/* Segmented pills resting in a soft track; the active pill fills with the
          section's pastel wash and edge-coloured label. */}
      <div className="inline-flex min-w-max gap-1 rounded-full bg-paper-deep p-1 smallcaps nav-tabs">
        {group.sub.map((s) => (
          <NavLink
            key={s.to}
            to={s.to}
            end={s.end}
            className={({ isActive }) =>
              "shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 transition-all duration-150 active:scale-95 " +
              (isActive
                ? `${activeFill} shadow-sm`
                : "text-ink-mute active:text-ink")
            }
          >
            {s.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function Masthead({
  me,
  onLog,
  install,
}: {
  me: Me | undefined;
  onLog: () => void;
  install: { onInstall: () => void } | null;
}) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { showAmounts, toggleAmounts } = useAmountVisibility();
  const { theme, toggleTheme } = useTheme();
  const logout = useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSuccess: () => {
      qc.clear();
      nav("/login", { replace: true });
    },
  });

  const today = new Date();
  const dateStr =
    today.toLocaleDateString("en-GB", { weekday: "long", day: "numeric" }) +
    " " +
    monthName(today.getMonth() + 1) +
    " " +
    today.getFullYear();

  return (
    <header className="relative pt-5 sm:pt-7 md:pt-9 lg:pt-11 pb-6 sm:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between smallcaps text-ink-mute border-t border-paper-rule pt-4 sm:pt-5">
        <span className="order-1">Beta Version</span>
        <span className="order-3 sm:order-2 hidden sm:inline">{dateStr}</span>
        <span
          className="order-2 sm:order-3 flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-6 self-start sm:self-auto"
          data-tutorial="masthead-tools"
        >
          <UserPrefsMenu me={me} />
          <button
            onClick={startTutorial}
            className="w-9 h-9 rounded-full border border-paper-rule bg-surface text-ink-soft hover:text-ink hover:bg-paper-deep transition-all duration-150 active:scale-95 flex items-center justify-center"
            title="Replay the tour"
            aria-label="Replay the tour"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2-2.7 4" />
              <circle cx="12" cy="17.4" r="0.6" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <button
            onClick={toggleTheme}
            className="w-9 h-9 rounded-full border border-paper-rule bg-surface text-ink-soft hover:text-ink hover:bg-paper-deep transition-all duration-150 active:scale-95 flex items-center justify-center"
            title={theme === "dark" ? "Switch to day mode" : "Switch to night mode"}
            aria-label={theme === "dark" ? "Switch to day mode" : "Switch to night mode"}
            aria-pressed={theme === "dark"}
          >
            {theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2" /><path d="M12 20v2" />
                <path d="M4.9 4.9l1.4 1.4" /><path d="M17.7 17.7l1.4 1.4" />
                <path d="M2 12h2" /><path d="M20 12h2" />
                <path d="M4.9 19.1l1.4-1.4" /><path d="M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
              </svg>
            )}
          </button>
          <button
            onClick={toggleAmounts}
            className="w-9 h-9 rounded-full border border-paper-rule bg-surface text-ink-soft hover:text-ink hover:bg-paper-deep transition-all duration-150 active:scale-95 flex items-center justify-center"
            title={showAmounts ? "Hide numbers" : "Show numbers"}
            aria-label={showAmounts ? "Hide numbers" : "Show numbers"}
          >
            {showAmounts ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                <circle cx="12" cy="12" r="2.5" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3l18 18" />
                <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                <path d="M9.4 5.3A10.2 10.2 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.3 3.9" />
                <path d="M6.1 6.1C3.6 7.7 2 12 2 12s3.5 7 10 7c1.2 0 2.3-.2 3.3-.5" />
              </svg>
            )}
          </button>
          {install && (
            <button
              onClick={install.onInstall}
              className="smallcaps px-4 py-2 rounded-full border border-paper-rule bg-surface text-ink-soft hover:text-ink hover:bg-paper-deep transition-all duration-150 active:scale-95"
            >
              Install
            </button>
          )}
          <button
            onClick={onLog}
            className="smallcaps px-4 py-2 rounded-full text-white shadow-sm hover:brightness-110 transition-all duration-150 active:scale-95"
            style={{ backgroundColor: "var(--section-edge)" }}
            title="Press N"
            data-tutorial="new-entry"
          >
            + New entry
          </button>
          {me && (
            <span className="text-ink-soft normal-case tracking-normal font-[550] hidden sm:inline">
              {me.username}
            </span>
          )}
          <button
            onClick={() => logout.mutate()}
            className="hover:text-accent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Sign out
          </button>
        </span>
      </div>

      <div className="mt-4 sm:mt-6 anim-in flex items-center gap-3 sm:gap-4">
        <span
          aria-hidden="true"
          className="grid place-items-center w-10 h-10 sm:w-12 sm:h-12 rounded-2xl shrink-0 shadow-sm"
          style={{ backgroundColor: "var(--section-wash)" }}
        >
          <svg
            viewBox="0 0 32 32"
            className="w-6 h-6 sm:w-7 sm:h-7"
            style={{ color: "var(--section-edge)" }}
            fill="none"
          >
            <path d="M6 25 L13 16 L18.5 20.5 L26 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="26" cy="7" r="2" fill="currentColor" />
          </svg>
        </span>
        <h1 className="display text-[22px] sm:text-[30px] md:text-[38px] lg:text-[46px] text-ink">
          Budget Tracker
        </h1>
      </div>

      <div className="mt-5 sm:mt-7 sm:-mx-4 md:-mx-6 lg:-mx-8 xl:-mx-10">
        <div
          className="anim-rule h-[3px] rounded-full"
          style={{
            background:
              "linear-gradient(90deg, var(--section-edge) 0%, var(--section-wash) 42%, transparent 100%)",
          }}
        />
      </div>
    </header>
  );
}

// Shown when the browser doesn't hand us a native install prompt (stock Chrome
// that didn't fire `beforeinstallprompt`, iOS Safari, in-app browsers, …). The
// steps are tailored to the detected platform so every user has a way in.
function InstallHelp({
  open,
  platform,
  onClose,
}: {
  open: boolean;
  platform: InstallPlatform;
  onClose: () => void;
}) {
  if (!open) return null;
  const copy =
    platform === "ios"
      ? {
          title: "Install on iPhone",
          steps: [
            "Open this page in Safari.",
            "Tap the Share button (the square with an up-arrow).",
            "Choose “Add to Home Screen”, then tap Add.",
          ],
        }
      : platform === "android"
      ? {
          title: "Install on Android",
          steps: [
            "Open this page in Chrome.",
            "Tap the ⋮ menu (top-right).",
            "Tap “Install app” or “Add to Home screen”, then confirm.",
          ],
        }
      : {
          title: "Install this app",
          steps: [
            "Open this page in Chrome or Safari.",
            "Open the browser menu.",
            "Choose “Install app” or “Add to Home screen”.",
          ],
        };
  return (
    <div className="modal-backdrop fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="modal-card w-full max-w-sm p-5">
        <h3 className="font-semibold">{copy.title}</h3>
        <ol className="text-sm text-ink-soft mt-3 space-y-2 list-decimal pl-5">
          {copy.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="smallcaps px-4 py-2 rounded-full border border-paper-rule bg-surface text-ink-soft hover:bg-paper-deep hover:text-ink transition-all duration-150 active:scale-95"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Persisted collapsed/expanded state for the desktop sidebar (mirrors the
// localStorage pattern used by the theme toggle).
const SIDEBAR_KEY = "bt_sidebar_collapsed";
function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  });
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

// Desktop left sidebar — the four top-level groups. Collapses to an icon rail.
// Mobile uses BottomNav + GroupSubNav instead (this is hidden under sm).
function Sidebar() {
  const { pathname } = useLocation();
  const [collapsed, toggle] = useSidebarCollapsed();
  const chatActive = pathname === "/chat";
  return (
    <aside
      className={
        "hidden sm:block shrink-0 bg-rail text-rail-ink border-r border-paper-rule transition-[width] " +
        (collapsed ? "w-14" : "w-52")
      }
    >
      <div className="sticky top-0 flex flex-col px-2.5 py-4">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand" : "Collapse"}
          className="self-end mb-2 w-7 h-7 rounded-lg border border-paper-rule text-rail-ink/60 hover:text-rail-ink hover:bg-paper-deep transition-all duration-150 active:scale-95 flex items-center justify-center"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {collapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
          </svg>
        </button>
        <nav data-tutorial="nav-panel">
          <ul className="flex flex-col gap-1">
            {navGroups.map((g) => {
              const active = g.routes.includes(pathname);
              return (
                <li key={g.key}>
                  <Link
                    to={g.to}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? g.label : undefined}
                    data-tutorial={`nav-${g.key}`}
                    className={
                      "flex items-center gap-3 rounded-xl py-2 transition-all duration-150 " +
                      (collapsed ? "justify-center px-0" : "px-2.5") +
                      " " +
                      (active
                        ? `${sectionActiveFill[g.key]} font-semibold`
                        : "text-rail-ink/60 hover:text-rail-ink hover:bg-paper-deep")
                    }
                  >
                    <span className="shrink-0">
                      <NavIcon name={g.key} />
                    </span>
                    {!collapsed && (
                      <span className="smallcaps nav-tabs rail-tabs whitespace-nowrap">{g.label}</span>
                    )}
                  </Link>
                </li>
              );
            })}
            <li>
              {/* A real route, like the other tabs — opens the full-page
                  conversation. The docked corner bar is the pop-up variant. */}
              <Link
                to="/chat"
                aria-current={chatActive ? "page" : undefined}
                title={collapsed ? "Chat" : undefined}
                data-tutorial="chat-launcher"
                className={
                  "w-full flex items-center gap-3 rounded-xl py-2 transition-all duration-150 " +
                  (collapsed ? "justify-center px-0" : "px-2.5") +
                  " " +
                  (chatActive
                    ? `${sectionActiveFill.chat} font-semibold`
                    : "text-rail-ink/60 hover:text-rail-ink hover:bg-paper-deep")
                }
              >
                <span className="shrink-0">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 12a8 8 0 0 1-12.2 6.8L3 20l1.3-4.8A8 8 0 1 1 21 12Z" />
                  </svg>
                </span>
                {!collapsed && (
                  <span className="smallcaps nav-tabs rail-tabs whitespace-nowrap">Chat</span>
                )}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </aside>
  );
}

// Desktop sub-tabs for the active group (Activity → Monthly/Daily, Manage →
// Budgets/Sources/Categories/Account). Mirrors the old top-nav underline look.
// Mobile uses GroupSubNav (segmented pills) instead.
function SubTabNav() {
  const { pathname } = useLocation();
  const group = navGroups.find((g) => g.routes.includes(pathname));
  if (!group?.sub) return null;
  const activeFill = sectionActiveFill[group.key];
  return (
    <nav className="hidden sm:block pb-4 mb-2">
      <ul className="inline-flex flex-wrap gap-1 rounded-full bg-paper-deep p-1 smallcaps nav-tabs sub-tabs">
        {group.sub.map((s) => (
          <li key={s.to}>
            <NavLink
              to={s.to}
              end={s.end}
              className={({ isActive }) =>
                "block rounded-full px-4 py-1.5 whitespace-nowrap transition-all duration-150 " +
                (isActive ? `${activeFill} shadow-sm` : "text-ink-mute hover:text-ink")
              }
            >
              {s.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function AppShell() {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  const pwaInstall = usePwaInstall();
  const { data: me, isLoading, isError } = useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/auth/me"),
    retry: false,
  });
  const [logOpen, setLogOpen] = useState(false);
  // The docked corner chat's open/closed state. The full-page conversation is
  // a route (/chat), so it isn't tracked here.
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setLogOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!me) return;
    return startSyncPolling(qc);
  }, [qc, me?.id]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center smallcaps text-ink-mute">
        Loading Budget Tracker…
      </div>
    );
  }
  if (isError || !me) {
    return <Navigate to="/login" replace />;
  }

  const installCta =
    isMobile && pwaInstall.shouldShowInstall
      ? {
          onInstall: () => {
            void pwaInstall.requestInstall();
          },
        }
      : null;

  // Full-width shell: the masthead and footer span the display with their own
  // padding, while the sidebar runs flush against the left edge between them.
  const pad = "px-3 sm:px-4 md:px-6 lg:px-8 xl:px-10";
  // The docked corner bar is redundant on the full-page chat — hide it there.
  const onChatPage = pathname === "/chat";
  return (
    <ChatProvider>
      <div className="pb-24 sm:pb-0" data-section={sectionFor(pathname)}>
        <div className="sm:flex sm:min-h-screen sm:flex-col">
          <div className={pad}>
            <Masthead me={me} onLog={() => setLogOpen(true)} install={installCta} />
          </div>
          {/* The row fills the remaining viewport height (sm:flex-1) so the dark
              sidebar stretches all the way to the bottom edge, with the footer
              tucked into the content column rather than stranded beside it. */}
          <div className="sm:flex sm:flex-1">
            <Sidebar />
            <div className={`min-w-0 flex-1 ${pad} sm:pt-4`}>
              <SubTabNav />
              <GroupSubNav />
              <main className="py-7 sm:py-10 md:py-12 lg:py-14">
                <Outlet />
              </main>
            </div>
          </div>
        </div>
        <QuickLog open={logOpen} onClose={() => setLogOpen(false)} />
        {!onChatPage && <WebChat open={chatOpen} onOpenChange={setChatOpen} />}
        <Tour
          me={me}
          openQuickLog={() => setLogOpen(true)}
          closeQuickLog={() => setLogOpen(false)}
          openChat={() => setChatOpen(true)}
          closeChat={() => setChatOpen(false)}
        />
        <BottomNav />
        <InstallHelp
          open={isMobile && pwaInstall.showInstructions}
          platform={pwaInstall.platform}
          onClose={pwaInstall.closeInstructions}
        />
      </div>
    </ChatProvider>
  );
}
