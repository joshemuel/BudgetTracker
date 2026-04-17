import { useEffect, useState } from "react";
import { Navigate, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { Me } from "@/types";
import { monthName } from "@/lib/format";
import QuickLog from "@/components/QuickLog";

const nav = [
  { to: "/", label: "Overview", end: true },
  { to: "/monthly", label: "Monthly" },
  { to: "/daily", label: "Daily" },
  { to: "/categories", label: "Categories" },
  { to: "/subscriptions", label: "Subscriptions" },
  { to: "/transactions", label: "Transactions" },
  { to: "/settings", label: "Settings" },
];

function Masthead({ me, onLog }: { me: Me | undefined; onLog: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
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
    <header className="relative pt-6 sm:pt-8 md:pt-10 pb-5 sm:pb-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between smallcaps text-ink-mute">
        <span className="order-1">Beta Version</span>
        <span className="order-3 sm:order-2 hidden md:inline">{dateStr}</span>
        <span className="order-2 sm:order-3 flex items-center gap-2 sm:gap-4 self-start sm:self-auto">
          <button
            onClick={onLog}
            className="smallcaps px-3 py-1 border border-ink text-ink hover:bg-ink hover:text-paper transition-colors"
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
            className="hover:text-accent transition-colors"
          >
            Sign out
          </button>
        </span>
      </div>

      <div className="mt-4 anim-in">
        <h1 className="display text-[48px] sm:text-[72px] md:text-[104px] lg:text-[124px] leading-[0.92] text-ink">
          Budget <span className="display-italic text-accent">Tracker</span>
        </h1>
      </div>

      <div className="mt-6 relative h-[6px]">
        <div className="anim-rule absolute inset-x-0 top-0 h-[3px] bg-ink" />
        <div
          className="anim-rule absolute inset-x-0 top-[5px] h-[1px] bg-ink"
          style={{ animationDelay: "0.1s" }}
        />
      </div>
    </header>
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

  return (
    <div className="max-w-[1560px] mx-auto px-3 sm:px-4 md:px-6 xl:px-8">
      <Masthead me={me} onLog={() => setLogOpen(true)} />
      <SectionNav />
      <main className="py-6 sm:py-8 md:py-10">
        <Outlet />
      </main>
      <footer className="py-8 sm:py-10 border-t border-paper-rule flex flex-col gap-2 sm:flex-row sm:justify-between smallcaps text-ink-mute">
        <span>Printed locally · Jakarta</span>
        <span>
          Press <kbd className="px-1 border border-paper-rule num">N</kbd> to log · <span className="italic">— fin —</span>
        </span>
      </footer>
      <QuickLog open={logOpen} onClose={() => setLogOpen(false)} />
    </div>
  );
}
