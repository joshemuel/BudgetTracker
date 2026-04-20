import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/api";
import type { Me, Monthly } from "@/types";
import { fmtCompactMoney, fmtMoney, fmtShort, monthName, toNumber } from "@/lib/format";
import { SectionTitle } from "@/components/Figure";
import { useAmountVisibility } from "@/lib/privacy";
import { preferredCurrency, withCurrency } from "@/lib/preferences";

export default function MonthlyPage() {
  const { showAmounts } = useAmountVisibility();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data: me } = useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/auth/me"),
  });
  const currency = preferredCurrency(me);

  const { data } = useQuery<Monthly>({
    queryKey: ["monthly", year, currency],
    queryFn: () => api.get<Monthly>(withCurrency(`/stats/monthly?year=${year}`, currency)),
  });
  const reportCurrency = data?.currency ?? currency;

  const isMobile = typeof window !== "undefined" ? window.innerWidth < 640 : false;
  const fmtAmount = (v: string | number) =>
    showAmounts
      ? isMobile
        ? fmtCompactMoney(v, reportCurrency)
        : fmtMoney(v, reportCurrency)
      : "••••••";

  const masked = (value: string) =>
    showAmounts ? value : <span className="masked-amount">••••••</span>;

  const chartData =
    data?.months.map((m) => ({
      name: monthName(m.month, true),
      month: m.month,
      Income: toNumber(m.income),
      Expense: toNumber(m.expense),
      Net: toNumber(m.net),
    })) ?? [];

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const isFuture = (m: number) =>
    year > currentYear || (year === currentYear && m > currentMonth);

  const totals = chartData.reduce(
    (acc, r) => ({
      income: acc.income + r.Income,
      expense: acc.expense + r.Expense,
    }),
    { income: 0, expense: 0 }
  );

  return (
    <div>
      <div className="flex items-end justify-between">
        <SectionTitle kicker="The long arc">
          {year} — Month by Month
        </SectionTitle>
        <div className="flex gap-2 smallcaps">
          {[year - 2, year - 1, year, year + 1].map((y) => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={
                "px-2 py-1 border-b-2 " +
                (y === year
                  ? "border-accent text-accent"
                  : "border-transparent hover:text-ink text-ink-mute")
              }
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 border-t border-ink pt-4">
        <div>
          <p className="smallcaps text-ink-mute">YTD In</p>
          <p className="num text-2xl text-gain">{masked(fmtAmount(totals.income))}</p>
        </div>
        <div>
          <p className="smallcaps text-ink-mute">YTD Out</p>
          <p className="num text-2xl text-accent">{masked(fmtAmount(totals.expense))}</p>
        </div>
        <div>
          <p className="smallcaps text-ink-mute">YTD Net</p>
          <p
            className={`num text-2xl ${
              totals.income - totals.expense >= 0 ? "text-gain" : "text-accent"
            }`}
          >
            {masked(fmtAmount(totals.income - totals.expense))}
          </p>
        </div>
      </div>

      <div className="mt-8 h-[240px] sm:h-[360px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#d9cdb4" vertical={false} />
            <XAxis
              dataKey="name"
              stroke="#4a4437"
              tick={{ fontFamily: "Instrument Sans", fontSize: 11 }}
              tickLine={false}
            />
            <YAxis
              stroke="#4a4437"
              tick={{ fontFamily: "JetBrains Mono", fontSize: 11 }}
              tickFormatter={(v) => (showAmounts ? fmtShort(v, reportCurrency) : "•••")}
              tickLine={false}
              width={72}
            />
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
            <Bar dataKey="Income">
              {chartData.map((row) => (
                <Cell
                  key={`inc-${row.month}`}
                  fill={isFuture(row.month) ? "transparent" : "#3f5d2e"}
                  stroke={isFuture(row.month) ? "#3f5d2e" : "none"}
                  strokeDasharray={isFuture(row.month) ? "2 2" : undefined}
                  strokeOpacity={isFuture(row.month) ? 0.35 : 1}
                />
              ))}
            </Bar>
            <Bar dataKey="Expense">
              {chartData.map((row) => (
                <Cell
                  key={`exp-${row.month}`}
                  fill={isFuture(row.month) ? "transparent" : "#a02a1a"}
                  stroke={isFuture(row.month) ? "#a02a1a" : "none"}
                  strokeDasharray={isFuture(row.month) ? "2 2" : undefined}
                  strokeOpacity={isFuture(row.month) ? 0.35 : 1}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="-mx-2 px-2 sm:mx-0 sm:px-0">
        <table className="ledger-table mt-10 w-full text-[11px] sm:text-[13px]">
          <thead>
            <tr>
              <th>Month</th>
              <th className="text-right">Income</th>
              <th className="text-right">Expense</th>
              <th className="text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {data?.months.map((m) => (
              <tr key={m.month} className={isFuture(m.month) ? "opacity-50" : ""}>
                <td className="font-[450]">{monthName(m.month)}</td>
                <td className="text-right num text-gain">{masked(fmtAmount(m.income))}</td>
                <td className="text-right num text-accent">{masked(fmtAmount(m.expense))}</td>
                <td
                  className={`text-right num ${
                    toNumber(m.net) >= 0 ? "text-gain" : "text-accent"
                  }`}
                >
                  {masked(fmtAmount(m.net))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
