import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  ReferenceLine,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/api";
import type { Daily, Me, Projection } from "@/types";
import { fmtMoney, fmtShort, monthName, toNumber } from "@/lib/format";
import { SectionTitle } from "@/components/Figure";
import { useAmountVisibility } from "@/lib/privacy";
import { preferredCurrency, withCurrency } from "@/lib/preferences";
import CategoryBreakdownModal from "@/components/CategoryBreakdownModal";

function toISO(y: number, m: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

export default function DailyPage() {
  const { showAmounts } = useAmountVisibility();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
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

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const todayDay = isCurrentMonth ? today.getDate() : 0;

  // Projected pace: outlier-trimmed average daily spend from the prior complete
  // months (computed on the backend). Only meaningful for the live month.
  const { data: projectionData } = useQuery<Projection>({
    queryKey: ["projection", year, month, currency],
    queryFn: () =>
      api.get<Projection>(withCurrency(`/stats/projection?year=${year}&month=${month}`, currency)),
    enabled: isCurrentMonth,
  });
  const avgDailyExpense = toNumber(projectionData?.avg_daily_expense ?? 0);
  // Typical spend for day-of-month d is dailyProfile[d - 1]. We cumulate it from
  // today forward so the projected pace follows the usual monthly rhythm rather
  // than a flat straight line. Falls back to the constant daily average if no
  // profile is available (e.g. brand-new user / no history).
  const dailyProfile = projectionData?.daily_profile ?? [];
  const profileFor = (day: number): number =>
    dailyProfile.length > 0 ? toNumber(dailyProfile[day - 1] ?? 0) : avgDailyExpense;

  const todayCumulative =
    isCurrentMonth && todayDay > 0
      ? (chartData.find((row) => row.day === todayDay)?.Cumulative ?? cum)
      : 0;

  let projectedCum = todayCumulative;
  let lastProjectedDay = todayDay;
  const chartDataWithGhost = chartData.map((row) => {
    const isPastToday = isCurrentMonth && todayDay > 0 && row.day > todayDay;
    let ghostProjection: number | null = null;
    if (isCurrentMonth && todayDay > 0 && row.day >= todayDay) {
      // Walk the projected cumulative forward one day at a time, adding each
      // day's typical (outlier-tamed) spend — a curve anchored at today's total.
      for (let d = lastProjectedDay + 1; d <= row.day; d++) {
        projectedCum += profileFor(d);
      }
      lastProjectedDay = row.day;
      ghostProjection = projectedCum;
    }
    return {
      ...row,
      Cumulative: isPastToday ? null : row.Cumulative,
      GhostProjection: ghostProjection,
    };
  });

  const maxGhost = Math.max(
    1,
    ...chartDataWithGhost.map((d) => d.Cumulative ?? 0),
    ...chartDataWithGhost.map((d) => d.GhostProjection ?? 0)
  );
  const maxExp = Math.max(1, ...days.map((d) => toNumber(d.expense)));

  const yAxisTick = (v: number) => (showAmounts ? fmtShort(v, reportCurrency) : "•••");

  return (
    <div>
      <div className="flex items-end justify-between flex-wrap gap-4">
        <SectionTitle>
          {monthName(month)} {year}
        </SectionTitle>
        <div className="flex gap-3 items-center w-full sm:w-auto justify-between sm:justify-start">
          <button
            className="smallcaps text-ink-mute hover:text-accent transition-colors px-2 py-1 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
            className="smallcaps text-ink-mute hover:text-accent transition-colors px-2 py-1 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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

      <div className="mt-2 flex items-center gap-4 smallcaps text-ink-mute">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5" style={{ background: "#a02a1a" }} />
          Cumulative
        </span>
        {isCurrentMonth && (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5"
              style={{ background: "rgba(72, 129, 193, 0.55)" }}
            />
            Projected
          </span>
        )}
      </div>

      <div className="h-[200px] sm:h-[280px] mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartDataWithGhost} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a02a1a" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#a02a1a" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="projFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(72, 129, 193, 1)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="rgba(72, 129, 193, 1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#d9cdb4" vertical={false} />
            <XAxis dataKey="day" stroke="#4a4437" tickLine={false} />
            <YAxis
              stroke="#4a4437"
              tickFormatter={yAxisTick}
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
                if (name === "GhostProjection") {
                  return [showAmounts ? fmtMoney(v, reportCurrency) : "••••••", "Projected pace"];
                }
                if (name === "Cumulative") {
                  return [showAmounts ? fmtMoney(v, reportCurrency) : "••••••", "Cumulative"];
                }
                return [showAmounts ? fmtMoney(v, reportCurrency) : "••••••", name];
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
            <Area
              type="monotone"
              dataKey="GhostProjection"
              stroke="rgba(72, 129, 193, 0.65)"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              fill="url(#projFill)"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="Cumulative"
              stroke="#a02a1a"
              strokeWidth={1.5}
              fill="url(#cumFill)"
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <SectionTitle>Heatmap</SectionTitle>
      <div className="grid grid-cols-7 gap-[2px] sm:gap-[3px]">
        {days.map((d) => {
          const ratio = toNumber(d.expense) / maxExp;
          const bg =
            ratio === 0
              ? "rgba(25, 23, 15, 0.04)"
              : `rgba(160, 42, 26, ${0.15 + ratio * 0.75})`;
          return (
            <div
              key={d.day}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedDay(d.day)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedDay(d.day);
                }
              }}
              title={`${monthName(month, true)} ${d.day} · ${showAmounts ? fmtMoney(d.expense, reportCurrency) : "••••••"}`}
              className="aspect-square relative border border-paper-rule p-1 cursor-pointer hover:outline hover:outline-1 hover:outline-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
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
                  {showAmounts ? fmtShort(d.expense, reportCurrency).replace(/^\S+\s/, "") : "••"}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <CategoryBreakdownModal
        open={selectedDay !== null}
        title={
          selectedDay !== null
            ? `${monthName(month, true)} ${selectedDay}, ${year} · spending`
            : ""
        }
        from={selectedDay !== null ? toISO(year, month, selectedDay) : ""}
        to={selectedDay !== null ? toISO(year, month, selectedDay) : ""}
        currency={reportCurrency}
        onClose={() => setSelectedDay(null)}
      />
    </div>
  );
}
