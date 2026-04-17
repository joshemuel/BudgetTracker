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
  const issueNo = String(today.getFullYear()).slice(2) + "." + String(today.getMonth() + 1).padStart(2, "0");
  const dateStr =
    today.toLocaleDateString("en-GB", { weekday: "long", day: "numeric" }) +
    " " +
    monthName(today.getMonth() + 1) +
    " " +
    today.getFullYear();

  return (
    <header className="relative pt-10 pb-6">
      <div className="flex items-baseline justify-between smallcaps text-ink-mute">
        <span>Vol. I · No. {issueNo}</span>
        <span className="hidden md:inline">{dateStr}</span>
        <span className="flex items-center gap-4">
          <button
            onClick={onLog}
            className="smallcaps px-3 py-1 border border-ink text-ink hover:bg-ink hover:text-paper transition-colors"
            title="Press N"
          >
            + New entry
          </button>
          {me && <span className="text-ink-soft normal-case tracking-normal font-[450] hidden md:inline">{me.username}</span>}
          <button
            onClick={() => logout.mutate()}
            className="hover:text-accent transition-colors"
          >
            Sign out
          </button>
        </span>
      </div>

      <div className="mt-4 anim-in">
        <h1 className="display text-[88px] md:text-[124px] leading-[0.9] text-ink">
          The <span className="display-italic text-accent">Ledger</span>
        </h1>
        <p className="mt-2 smallcaps text-ink-mute">
          A private accounting of means, methods &amp; minor indulgences
        </p>
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
    <nav className="py-3 border-b border-paper-rule overflow-x-auto">
      <ul className="flex gap-6 smallcaps">
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
        Loading the ledger…
      </div>
    );
  }
  if (isError || !me) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="max-w-[1200px] mx-auto px-6 md:px-10">
      <Masthead me={me} onLog={() => setLogOpen(true)} />
      <SectionNav />
      <main className="py-10">
        <Outlet />
      </main>
      <footer className="py-10 border-t border-paper-rule flex justify-between smallcaps text-ink-mute">
        <span>Printed locally · Jakarta</span>
        <span>Press <kbd className="px-1 border border-paper-rule num">N</kbd> to log · <span className="italic">— fin —</span></span>
      </footer>
      <QuickLog open={logOpen} onClose={() => setLogOpen(false)} />
    </div>
  );
}

