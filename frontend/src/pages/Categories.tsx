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
import type { CategoryStats } from "@/types";
import { fmtIDR, fmtPct, todayISO, toNumber } from "@/lib/format";
import { SectionTitle } from "@/components/Figure";

const PALETTE = [
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

export default function CategoriesPage() {
  const [from, setFrom] = useState(firstOfMonthISO());
  const [to, setTo] = useState(todayISO());

  const { data } = useQuery<CategoryStats>({
    queryKey: ["category-stats", from, to],
    queryFn: () =>
      api.get<CategoryStats>(`/stats/categories?from=${from}&to=${to}`),
  });

  const rows = (data?.categories ?? []).filter(
    (c) => toNumber(c.expense) > 0
  );
  const total = rows.reduce((a, r) => a + toNumber(r.expense), 0);
  const pieData = rows.slice(0, 10).map((r) => ({
    name: r.category_name,
    value: toNumber(r.expense),
  }));

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

      <div className="grid grid-cols-12 gap-8 mt-8">
        <div className="col-span-12 md:col-span-5 h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                innerRadius={70}
                outerRadius={130}
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
                formatter={(v: number) => fmtIDR(v)}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="col-span-12 md:col-span-7">
          <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
            <table className="ledger-table min-w-[640px]">
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
                        {fmtIDR(r.expense)}
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
                  <td className="text-right num">{fmtIDR(total)}</td>
                  <td></td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
