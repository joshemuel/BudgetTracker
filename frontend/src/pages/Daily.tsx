import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Line,
  ReferenceLine,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/api";
import type { Daily, Me } from "@/types";
import { fmtMoney, fmtShort, monthName, toNumber } from "@/lib/format";
import { SectionTitle } from "@/components/Figure";
import { preferredCurrency, withCurrency } from "@/lib/preferences";

export default function DailyPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const { data: me } = useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/auth/me"),
  });
  const currency = preferredCurrency(me);

  const { data } = useQuery<Daily>({
    queryKey: ["daily", year, month, currency],
    queryFn: () => api.get<Daily>(withCurrency(`/stats/daily?year=${year}&month=${month}`, currency)),
  });
  const reportCurrency = data?.currency ?? currency;

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

  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  const { data: prevData } = useQuery<Daily>({
    queryKey: ["daily", previousYear, previousMonth, currency, "prev"],
    queryFn: () =>
      api.get<Daily>(withCurrency(`/stats/daily?year=${previousYear}&month=${previousMonth}`, currency)),
  });

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const todayDay = isCurrentMonth ? today.getDate() : 0;

  const previousByDay = new Map<number, number>();
  let prevCum = 0;
  for (const row of prevData?.days ?? []) {
    prevCum += toNumber(row.expense);
    previousByDay.set(row.day, prevCum);
  }

  const projectedDailyAvg =
    isCurrentMonth && todayDay > 0 ? cum / Math.max(1, todayDay) : 0;

  const chartDataWithGhost = chartData.map((row) => {
    const prev = previousByDay.get(row.day);
    const ghostPrev = isCurrentMonth && row.day > todayDay ? prev ?? null : null;
    const ghostLinear =
      isCurrentMonth && row.day > todayDay ? cum + projectedDailyAvg * (row.day - todayDay) : null;
    return {
      ...row,
      GhostPrevious: ghostPrev,
      GhostProjection: ghostLinear,
    };
  });

  const maxGhost = Math.max(
    1,
    ...chartDataWithGhost.map((d) => d.Cumulative),
    ...chartDataWithGhost.map((d) => d.GhostPrevious ?? 0),
    ...chartDataWithGhost.map((d) => d.GhostProjection ?? 0)
  );
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

      <div className="h-[200px] sm:h-[280px] mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartDataWithGhost} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
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
              tickFormatter={(v) => fmtShort(v, reportCurrency)}
              tick={{ fontFamily: "JetBrains Mono", fontSize: 11 }}
              tickLine={false}
              width={72}
              domain={[0, maxGhost]}
            />
            <Tooltip
              contentStyle={{
                background: "#f5efe3",
                border: "1px solid #19170f",
                borderRadius: 0,
                fontFamily: "Instrument Sans",
              }}
              formatter={(v: number, name: string) => {
                if (name === "GhostPrevious") return [fmtMoney(v, reportCurrency), "Prev month pace"];
                if (name === "GhostProjection") return [fmtMoney(v, reportCurrency), "Linear projection"];
                if (name === "Cumulative") return [fmtMoney(v, reportCurrency), "Cumulative"];
                return [fmtMoney(v, reportCurrency), name];
              }}
              labelFormatter={(d) => `${monthName(month, true)} ${d}`}
            />
            {isCurrentMonth && todayDay > 0 && (
              <ReferenceLine
                x={todayDay}
                stroke="#19170f"
                strokeDasharray="4 4"
                label={{
                  value: "Today",
                  fill: "#19170f",
                  fontSize: 10,
                  position: "insideTopRight",
                }}
              />
            )}
            <Line
              type="monotone"
              dataKey="GhostPrevious"
              stroke="#877e6a"
              strokeWidth={1.2}
              strokeDasharray="5 4"
              dot={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="GhostProjection"
              stroke="#b4721f"
              strokeWidth={1.1}
              strokeDasharray="2 4"
              dot={false}
              connectNulls={false}
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
              title={`${monthName(month, true)} ${d.day} · ${fmtMoney(d.expense, reportCurrency)}`}
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
                  {fmtShort(d.expense, reportCurrency).replace(/^\S+\s/, "")}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
