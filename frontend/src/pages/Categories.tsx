import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { api } from "@/api";
import type { CategoryStats, CurrencyCode, Me } from "@/types";
import { fmtCompactMoney, fmtMoney, fmtPct, todayISO, toNumber } from "@/lib/format";
import { SectionTitle } from "@/components/Figure";
import { useAmountVisibility } from "@/lib/privacy";
import { preferredCurrency, withCurrency } from "@/lib/preferences";

export const PALETTE = [
  "#a02a1a",
  "#3f5d2e",
  "#b4721f",
  "#19170f",
  "#4a4437",
  "#877e6a",
  "#c26a1f",
  "#6b4e2e",
  "#7d2a2a",
  "#2a5d4e",
];

function firstOfMonthISO(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export function CategoriesBreakdown({
  from,
  to,
  currency,
  compact = false,
}: {
  from: string;
  to: string;
  currency: CurrencyCode;
  compact?: boolean;
}) {
  const { showAmounts } = useAmountVisibility();
  const isMobile = typeof window !== "undefined" ? window.innerWidth < 640 : false;

  const { data } = useQuery<CategoryStats>({
    queryKey: ["category-stats", from, to, currency],
    queryFn: () =>
      api.get<CategoryStats>(
        withCurrency(`/stats/categories?from=${from}&to=${to}`, currency)
      ),
  });
  const reportCurrency = data?.currency ?? currency;
  const fmtAmount = (v: string | number) =>
    showAmounts
      ? isMobile
        ? fmtCompactMoney(v, reportCurrency)
        : fmtMoney(v, reportCurrency)
      : "••••••";

  const masked = (value: string) =>
    showAmounts ? value : <span className="masked-amount">••••••</span>;

  const rows = (data?.categories ?? []).filter((c) => toNumber(c.expense) > 0);
  const total = rows.reduce((a, r) => a + toNumber(r.expense), 0);
  const pieData = rows.slice(0, 10).map((r) => ({
    name: r.category_name,
    value: toNumber(r.expense),
  }));
  const pieInnerRadius = compact ? (isMobile ? 38 : 54) : isMobile ? 46 : 70;
  const pieOuterRadius = compact ? (isMobile ? 72 : 104) : isMobile ? 86 : 130;

  if (rows.length === 0) {
    return (
      <p className="text-ink-mute text-sm py-6 text-center border-t border-paper-rule">
        No spending recorded for this range.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-6 sm:gap-8">
      <div className={`col-span-12 md:col-span-5 ${compact ? "h-[220px] sm:h-[260px]" : "h-[260px] sm:h-[320px]"}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              innerRadius={pieInnerRadius}
              outerRadius={pieOuterRadius}
              stroke="#f5efe3"
              strokeWidth={1}
            >
              {pieData.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "#f5efe3",
                border: "1px solid #19170f",
                borderRadius: 0,
                fontFamily: "Instrument Sans",
              }}
              formatter={(v: number) =>
                showAmounts ? fmtMoney(v, reportCurrency) : "••••••"
              }
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="col-span-12 md:col-span-7">
        <div className="-mx-2 px-2 sm:mx-0 sm:px-0">
          <table className="ledger-table w-full text-[11px] sm:text-[13px]">
            <thead>
              <tr>
                <th>Category</th>
                <th className="text-right">Spent</th>
                <th className="text-right">Share</th>
                <th className="text-right">#</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const share = total ? toNumber(r.expense) / total : 0;
                return (
                  <tr key={r.category_id}>
                    <td className="font-[450] flex items-center gap-2">
                      <span
                        className="inline-block w-2 h-2"
                        style={{ background: PALETTE[i % PALETTE.length] }}
                      />
                      {r.category_name}
                    </td>
                    <td className="text-right num text-accent">
                      {masked(fmtAmount(r.expense))}
                    </td>
                    <td className="text-right num text-ink-mute">
                      {fmtPct(share)}
                    </td>
                    <td className="text-right num text-ink-mute">
                      {r.transactions}
                    </td>
                  </tr>
                );
              })}
              <tr className="font-[500]">
                <td className="smallcaps">Total</td>
                <td className="text-right num">{masked(fmtAmount(total))}</td>
                <td></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function CategoriesPage() {
  const [from, setFrom] = useState(firstOfMonthISO());
  const [to, setTo] = useState(todayISO());

  const { data: me } = useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/auth/me"),
  });
  const currency = preferredCurrency(me);

  return (
    <div>
      <SectionTitle kicker="Where the rupiah went">By Category</SectionTitle>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
        <label className="block">
          <span className="smallcaps text-ink-mute">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 w-full bg-transparent border-b border-ink py-1 font-[var(--font-mono)]"
          />
        </label>
        <label className="block">
          <span className="smallcaps text-ink-mute">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 w-full bg-transparent border-b border-ink py-1 font-[var(--font-mono)]"
          />
        </label>
      </div>

      <div className="mt-8">
        <CategoriesBreakdown from={from} to={to} currency={currency} />
      </div>
    </div>
  );
}
