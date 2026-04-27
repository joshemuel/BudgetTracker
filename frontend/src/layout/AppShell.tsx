import { useEffect, useState } from "react";
import { Navigate, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { Me } from "@/types";
import { monthName } from "@/lib/format";
import { useIsMobile } from "@/lib/mediaQuery";
import { useAmountVisibility } from "@/lib/privacy";
import { usePwaInstall } from "@/lib/pwaInstall";
import { useTheme } from "@/lib/theme";
import { startSyncPolling } from "@/lib/sync";
import QuickLog from "@/components/QuickLog";
import UserPrefsMenu from "@/components/UserPrefsMenu";
import WebChat from "@/components/WebChat";

const nav = [
  { to: "/", label: "Overview", end: true },
  { to: "/monthly", label: "Monthly" },
  { to: "/daily", label: "Daily" },
  { to: "/subscriptions", label: "Subscriptions" },
  { to: "/transactions", label: "Transactions" },
  { to: "/budgets", label: "Budgets" },
  { to: "/settings", label: "Settings" },
];

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
    <header className="relative pt-5 sm:pt-7 md:pt-9 lg:pt-11 pb-6 sm:pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between smallcaps text-ink-mute border-t border-paper-rule pt-4 sm:pt-5">
        <span className="order-1">Beta Version</span>
        <span className="order-3 sm:order-2 hidden sm:inline">{dateStr}</span>
        <span className="order-2 sm:order-3 flex items-center gap-4 sm:gap-6 self-start sm:self-auto">
          <UserPrefsMenu me={me} />
          <button
            onClick={toggleTheme}
            className="w-8 h-8 rounded-sm border border-ink text-ink hover:bg-ink hover:text-paper transition-colors flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
            className="w-8 h-8 rounded-sm border border-ink text-ink hover:bg-ink hover:text-paper transition-colors flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
              className="smallcaps px-3 py-1.5 border border-ink text-ink hover:bg-ink hover:text-paper transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Install
            </button>
          )}
          <button
            onClick={onLog}
            className="smallcaps px-3 py-1.5 border border-ink text-ink hover:bg-ink hover:text-paper transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            title="Press N"
          >
            + New entry
          </button>
          {me && (
            <span className="text-ink-soft normal-case tracking-normal font-[450] hidden sm:inline">
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

      <div className="mt-6 sm:mt-8 md:mt-10 anim-in">
        <h1 className="display text-[28px] sm:text-[52px] md:text-[76px] lg:text-[94px] xl:text-[106px] leading-[0.92] text-ink">
          Budget <span className="display-italic text-accent">Tracker</span>
        </h1>
      </div>

      <div className="mt-6 sm:mt-8 relative h-[6px]">
        <div className="anim-rule absolute inset-x-0 top-0 h-[3px] bg-ink" />
        <div
          className="anim-rule absolute inset-x-0 top-[5px] h-[1px] bg-ink"
          style={{ animationDelay: "0.1s" }}
        />
      </div>
    </header>
  );
}

function IosInstallHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="modal-card w-full max-w-sm p-5">
        <h3 className="font-semibold">Install on iPhone</h3>
        <p className="text-sm text-ink-soft mt-2">
          Open this page in Safari, tap the Share button, then choose Add to Home Screen.
        </p>
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="smallcaps px-3 py-1 border border-ink/30 rounded"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionNav() {
  return (
    <nav className="py-3 border-b border-paper-rule overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
      <ul className="flex gap-4 sm:gap-6 smallcaps min-w-max">
        {nav.map((n) => (
          <li key={n.to}>
            <NavLink
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                "whitespace-nowrap pb-1 border-b-2 transition-colors " +
                (isActive
                  ? "border-accent text-accent"
                  : "border-transparent text-ink-soft hover:text-ink")
              }
            >
              {n.label}
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
  const pwaInstall = usePwaInstall();
  const { data: me, isLoading, isError } = useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/auth/me"),
    retry: false,
  });
  const [logOpen, setLogOpen] = useState(false);

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

  return (
    <div className="max-w-[1160px] lg:max-w-[1220px] mx-auto px-3 sm:px-4 md:px-5 lg:px-6 xl:px-8">
      <Masthead me={me} onLog={() => setLogOpen(true)} install={installCta} />
      <SectionNav />
      <main className="py-7 sm:py-10 md:py-12 lg:py-14">
        <Outlet />
      </main>
      <footer className="py-10 sm:py-14 border-t border-paper-rule flex flex-col gap-2 sm:flex-row sm:justify-between smallcaps text-ink-mute">
        <span>Printed locally · Jakarta</span>
        <span>
          Press <kbd className="px-1 border border-paper-rule num">N</kbd> to log · <span className="italic">— fin —</span>
        </span>
      </footer>
      <QuickLog open={logOpen} onClose={() => setLogOpen(false)} />
      <WebChat />
      <IosInstallHelp
        open={isMobile && pwaInstall.showIosInstructions}
        onClose={pwaInstall.closeIosInstructions}
      />
    </div>
  );
}
