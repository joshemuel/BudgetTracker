import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/api";
import type { Monthly } from "@/types";
import { fmtIDR, fmtShort, monthName, toNumber } from "@/lib/format";
import { SectionTitle } from "@/components/Figure";

export default function MonthlyPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data } = useQuery<Monthly>({
    queryKey: ["monthly", year],
    queryFn: () => api.get<Monthly>(`/stats/monthly?year=${year}`),
  });

  const chartData =
    data?.months.map((m) => ({
      name: monthName(m.month, true),
      Income: toNumber(m.income),
      Expense: toNumber(m.expense),
      Net: toNumber(m.net),
    })) ?? [];

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

      <div className="grid grid-cols-3 gap-6 border-t border-ink pt-4">
        <div>
          <p className="smallcaps text-ink-mute">YTD In</p>
          <p className="num text-2xl text-gain">{fmtIDR(totals.income)}</p>
        </div>
        <div>
          <p className="smallcaps text-ink-mute">YTD Out</p>
          <p className="num text-2xl text-accent">{fmtIDR(totals.expense)}</p>
        </div>
        <div>
          <p className="smallcaps text-ink-mute">YTD Net</p>
          <p
            className={`num text-2xl ${
              totals.income - totals.expense >= 0 ? "text-gain" : "text-accent"
            }`}
          >
            {fmtIDR(totals.income - totals.expense)}
          </p>
        </div>
      </div>

      <div className="mt-8 h-[360px]">
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
              tickFormatter={(v) => fmtShort(v)}
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
              formatter={(v: number) => fmtIDR(v)}
            />
            <Bar dataKey="Income" fill="#3f5d2e" />
            <Bar dataKey="Expense" fill="#a02a1a" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <table className="ledger-table mt-10">
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
            <tr key={m.month}>
              <td className="font-[450]">{monthName(m.month)}</td>
              <td className="text-right num text-gain">{fmtIDR(m.income)}</td>
              <td className="text-right num text-accent">{fmtIDR(m.expense)}</td>
              <td
                className={`text-right num ${
                  toNumber(m.net) >= 0 ? "text-gain" : "text-accent"
                }`}
              >
                {fmtIDR(m.net)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
