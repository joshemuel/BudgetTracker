import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/api";
import type { Me, Overview, Source } from "@/types";
import { fmtCompactMoney, fmtMoney, fmtPct, monthName, toNumber } from "@/lib/format";
import { Figure, SectionTitle } from "@/components/Figure";
import { preferredCurrency, withCurrency } from "@/lib/preferences";

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

export default function OverviewPage() {
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
    isMobile ? fmtCompactMoney(v, ov.currency) : fmtMoney(v, ov.currency);

  return (
    <div className="grid grid-cols-12 gap-3 sm:gap-6 lg:gap-8">
      <section className="col-span-12">
        <p className="smallcaps text-ink-mute">
          {monthName(ov.month)} MMXXVI · Day {ov.today_day} of {ov.days_in_month}
        </p>
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
            <Link to="/settings" className="underline decoration-accent">
              Settings
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
            {fmtAmount(ov.credit.outstanding)}
          </p>
          <p className="text-sm text-ink-soft mt-1">Outstanding balance (negative means payable)</p>

          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="smallcaps text-ink-mute">This Month</p>
              <p className="num text-accent">{fmtAmount(ov.credit.month_charges)}</p>
              <p className="text-ink-mute text-xs">charges</p>
            </div>
            <div>
              <p className="smallcaps text-ink-mute">Paid</p>
              <p className="num text-gain">{fmtAmount(ov.credit.month_payments)}</p>
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
                    {s.name}
                    {s.is_credit_card && <span className="ml-2 smallcaps text-accent">credit</span>}
                  </span>
                  <span
                    className={`num ${
                      s.is_credit_card ? "text-accent" : toNumber(s.current_balance) < 0 ? "text-accent" : ""
                    }`}
                  >
                    {new Intl.NumberFormat("de-DE", {
                      minimumFractionDigits: s.currency === "JPY" ? 0 : 2,
                      maximumFractionDigits: s.currency === "JPY" ? 0 : 2,
                    }).format(toNumber(s.current_balance))} {s.currency}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
