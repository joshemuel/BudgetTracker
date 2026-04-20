import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/api";
import type { Me, Overview, Source } from "@/types";
import { fmtCompactMoney, fmtMoney, fmtPct, monthName, toNumber } from "@/lib/format";
import { Figure, SectionTitle } from "@/components/Figure";
import { useAmountVisibility } from "@/lib/privacy";
import { preferredCurrency, withCurrency } from "@/lib/preferences";
import { SYNC_EVENT } from "@/lib/sync";

const STATUS_LABEL: Record<string, string> = {
  ahead: "Ahead",
  on_track: "On Track",
  behind: "Behind",
  over: "Over",
};

const STATUS_STYLE: Record<string, string> = {
  ahead: "text-gain",
  on_track: "text-ink-soft",
  behind: "text-warn",
  over: "text-accent",
};

function Bar({ pct, status }: { pct: number; status: string }) {
  const capped = Math.min(1, Math.max(0, pct));
  const color =
    status === "over"
      ? "bg-accent"
      : status === "behind"
      ? "bg-warn"
      : status === "ahead"
      ? "bg-gain"
      : "bg-ink";
  return (
    <div className="w-full h-[3px] bg-paper-deep relative overflow-hidden">
      <div className={`absolute inset-y-0 left-0 ${color}`} style={{ width: `${capped * 100}%` }} />
      {pct > 1 && <div className="absolute inset-y-0 right-0 w-[2px] bg-accent" />}
    </div>
  );
}

function eyeButtonIcon(show: boolean) {
  if (show) {
    return (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    );
  }

  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
      <path d="M9.4 5.3A10.2 10.2 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.3 3.9" />
      <path d="M6.1 6.1C3.6 7.7 2 12 2 12s3.5 7 10 7c1.2 0 2.3-.2 3.3-.5" />
    </svg>
  );
}

export default function OverviewPage() {
  const { showAmounts, toggleAmounts } = useAmountVisibility();
  const [freshPulse, setFreshPulse] = useState(false);

  useEffect(() => {
    let timer: number | null = null;
    const onSync = () => {
      setFreshPulse(true);
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setFreshPulse(false), 1100);
    };
    window.addEventListener(SYNC_EVENT, onSync as EventListener);
    return () => {
      window.removeEventListener(SYNC_EVENT, onSync as EventListener);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  const { data: me } = useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/auth/me"),
  });
  const currency = preferredCurrency(me);

  const { data: ov } = useQuery<Overview>({
    queryKey: ["overview", currency],
    queryFn: () => api.get<Overview>(withCurrency("/stats/overview", currency)),
  });
  const { data: sources } = useQuery<Source[]>({
    queryKey: ["sources"],
    queryFn: () => api.get<Source[]>("/sources"),
  });

  if (!ov) return <p className="smallcaps text-ink-mute">Assembling the ledger…</p>;

  const net = toNumber(ov.totals.net);
  const netTone = net >= 0 ? "gain" : "accent";
  const paceRatio = ov.today_day / ov.days_in_month;
  const isMobile = typeof window !== "undefined" ? window.innerWidth < 640 : false;
  const fmtAmount = (v: string | number) =>
    showAmounts
      ? isMobile
        ? fmtCompactMoney(v, ov.currency)
        : fmtMoney(v, ov.currency)
      : "••••••";

  const masked = (value: string) =>
    showAmounts ? value : <span className="masked-amount">••••••</span>;

  return (
    <div className={"grid grid-cols-12 gap-3 sm:gap-6 lg:gap-8 transition-colors duration-500 " + (freshPulse ? "bg-highlight/35" : "") }>
      <section className="col-span-12">
        <div className="flex items-center justify-between gap-3">
          <p className="smallcaps text-ink-mute">
            {monthName(ov.month)} MMXXVI · Day {ov.today_day} of {ov.days_in_month}
          </p>
          <button
            type="button"
            onClick={toggleAmounts}
            className="smallcaps text-ink-mute hover:text-accent inline-flex items-center gap-1"
            title={showAmounts ? "Hide values" : "Show values"}
          >
            {eyeButtonIcon(showAmounts)}
            {showAmounts ? "Hide" : "Show"}
          </button>
        </div>
        <h2 className="display text-2xl sm:text-3xl md:text-4xl lg:text-5xl mt-2">
          <span className="display-italic">A month</span>, in figures.
        </h2>
      </section>

      <section className="col-span-12 md:col-span-4 border-t border-ink pt-2">
        <Figure
          label="In"
          value={fmtAmount(ov.totals.income)}
          tone="gain"
          sub="Credits posted this month"
          emphasize={isMobile}
        />
      </section>
      <section className="col-span-12 md:col-span-4 border-t border-ink pt-2">
        <Figure
          label="Out"
          value={fmtAmount(ov.totals.expense)}
          tone="accent"
          sub="Debits posted this month"
          emphasize={isMobile}
        />
      </section>
      <section className="col-span-12 md:col-span-4 border-t border-ink pt-2">
        <Figure
          label="Net"
          value={fmtAmount(ov.totals.net)}
          tone={netTone}
          sub={`Pace · ${fmtPct(paceRatio)} of month elapsed`}
          emphasize={isMobile}
        />
      </section>

      <section className="col-span-12 lg:col-span-8 mt-4 sm:mt-6">
        <SectionTitle kicker="The running totals">By Category</SectionTitle>
        {ov.budgets.length === 0 ? (
          <p className="text-ink-soft">
            No budgets set. Visit{" "}
            <Link to="/budgets" className="underline decoration-accent">
              Budgets
            </Link>{" "}
            to draw your first limit.
          </p>
        ) : (
          <div className="-mx-2 px-2 sm:mx-0 sm:px-0">
            <table className="ledger-table w-full text-[11px] sm:text-[13px]">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="text-right">Spent</th>
                  <th className="text-right">Limit</th>
                  <th className="text-right">Remaining</th>
                  <th className="w-[96px] sm:w-40">Pace</th>
                  <th className="text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {ov.budgets.map((b) => (
                  <tr key={b.category_id}>
                    <td className="font-[450]">{b.category_name}</td>
                    <td className="text-right num">{fmtAmount(b.spent)}</td>
                    <td className="text-right num text-ink-mute">{fmtAmount(b.limit)}</td>
                    <td
                      className={`text-right num ${
                        toNumber(b.remaining) < 0 ? "text-accent" : ""
                      }`}
                    >
                      {fmtAmount(b.remaining)}
                    </td>
                    <td>
                      <Bar pct={b.pct_used} status={b.status} />
                    </td>
                    <td className={`text-right smallcaps ${STATUS_STYLE[b.status]}`}>
                      {STATUS_LABEL[b.status]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <aside className="col-span-12 lg:col-span-4 mt-6 space-y-10">
        <div className="border-t-2 border-ink pt-4">
          <p className="smallcaps text-ink-mute">Credit Card</p>
          <p className="num text-4xl sm:text-3xl mt-1 text-accent">
            {masked(fmtAmount(ov.credit.outstanding))}
          </p>
          <p className="text-sm text-ink-soft mt-1">Outstanding balance (negative means payable)</p>

          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="smallcaps text-ink-mute">This Month</p>
              <p className="num text-accent">{masked(fmtAmount(ov.credit.month_charges))}</p>
              <p className="text-ink-mute text-xs">charges</p>
            </div>
            <div>
              <p className="smallcaps text-ink-mute">Paid</p>
              <p className="num text-gain">{masked(fmtAmount(ov.credit.month_payments))}</p>
              <p className="text-ink-mute text-xs">payments</p>
            </div>
          </div>
        </div>

        <div>
          <p className="smallcaps text-ink-mute">Accounts</p>
          <ul className="mt-2 divide-y divide-paper-rule">
            {(sources ?? [])
              .filter((s) => s.active)
              .map((s) => (
                <li key={s.id} className="py-2 flex justify-between items-baseline">
                  <span className="font-[450]">
                    {showAmounts ? (
                      <>
                        {s.name}
                        {s.is_credit_card && (
                          <span className="ml-2 smallcaps text-accent">credit</span>
                        )}
                      </>
                    ) : (
                      <span className="masked-amount">••••••</span>
                    )}
                  </span>
                  <span
                    className={`num ${
                      s.is_credit_card ? "text-accent" : toNumber(s.current_balance) < 0 ? "text-accent" : ""
                    }`}
                  >
                    {showAmounts
                      ? `${new Intl.NumberFormat("de-DE", {
                          minimumFractionDigits: s.currency === "JPY" ? 0 : 2,
                          maximumFractionDigits: s.currency === "JPY" ? 0 : 2,
                        }).format(toNumber(s.current_balance))} ${s.currency}`
                      : "••••••"}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
