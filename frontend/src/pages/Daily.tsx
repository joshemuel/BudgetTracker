import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/api";
import type { Daily } from "@/types";
import { fmtIDR, fmtShort, monthName, toNumber } from "@/lib/format";
import { SectionTitle } from "@/components/Figure";

export default function DailyPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data } = useQuery<Daily>({
    queryKey: ["daily", year, month],
    queryFn: () => api.get<Daily>(`/stats/daily?year=${year}&month=${month}`),
  });

  const days = data?.days ?? [];
  let cum = 0;
  const chartData = days.map((d) => {
    cum += toNumber(d.expense);
    return {
      day: d.day,
      Expense: toNumber(d.expense),
      Cumulative: cum,
    };
  });
  const maxExp = Math.max(1, ...days.map((d) => toNumber(d.expense)));

  return (
    <div>
      <div className="flex items-end justify-between flex-wrap gap-4">
        <SectionTitle kicker="Day by day, as written">
          {monthName(month)} {year}
        </SectionTitle>
        <div className="flex gap-3 items-center w-full sm:w-auto justify-between sm:justify-start">
          <button
            className="smallcaps text-ink-mute hover:text-accent"
            onClick={() => {
              if (month === 1) {
                setMonth(12);
                setYear(year - 1);
              } else setMonth(month - 1);
            }}
          >
            ← Prev
          </button>
          <button
            className="smallcaps text-ink-mute hover:text-accent"
            onClick={() => {
              if (month === 12) {
                setMonth(1);
                setYear(year + 1);
              } else setMonth(month + 1);
            }}
          >
            Next →
          </button>
        </div>
      </div>

      <div className="h-[280px] mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a02a1a" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#a02a1a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#d9cdb4" vertical={false} />
            <XAxis dataKey="day" stroke="#4a4437" tickLine={false} />
            <YAxis
              stroke="#4a4437"
              tickFormatter={fmtShort}
              tick={{ fontFamily: "JetBrains Mono", fontSize: 11 }}
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
              labelFormatter={(d) => `${monthName(month, true)} ${d}`}
            />
            <Area
              type="monotone"
              dataKey="Cumulative"
              stroke="#a02a1a"
              strokeWidth={1.5}
              fill="url(#cumFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <SectionTitle kicker="Daily density">Heat of the month</SectionTitle>
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-[3px]">
        {days.map((d) => {
          const ratio = toNumber(d.expense) / maxExp;
          const bg =
            ratio === 0
              ? "rgba(25, 23, 15, 0.04)"
              : `rgba(160, 42, 26, ${0.15 + ratio * 0.75})`;
          return (
            <div
              key={d.day}
              title={`${monthName(month, true)} ${d.day} · ${fmtIDR(d.expense)}`}
              className="aspect-square relative border border-paper-rule p-1"
              style={{ backgroundColor: bg }}
            >
              <span
                className={`text-[10px] smallcaps ${
                  ratio > 0.5 ? "text-paper" : "text-ink-mute"
                }`}
              >
                {d.day}
              </span>
              {ratio > 0 && (
                <span
                  className={`absolute inset-x-1 bottom-1 num text-[10px] ${
                    ratio > 0.5 ? "text-paper" : "text-ink"
                  }`}
                >
                  {fmtShort(d.expense).replace("Rp ", "")}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
