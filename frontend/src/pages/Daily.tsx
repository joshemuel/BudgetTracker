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
import { useTheme } from "@/lib/theme";
import CategoryBreakdownModal from "@/components/CategoryBreakdownModal";

function toISO(y: number, m: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

export default function DailyPage() {
  const { showAmounts } = useAmountVisibility();
  const { theme } = useTheme();
  const dark = theme === "dark";
  // Chart chrome, branched on theme. The cumulative spend area is the Activity
  // GREEN; the projection stays a muted dashed gray so it reads as "estimate".
  const gridStroke = dark ? "#2c313d" : "#e2e5ef";
  const axisTick = dark ? "#9aa3b2" : "#6a7385";
  const spendColor = dark ? "#84c993" : "#3f8f57";
  const projColor = "#9aa3b2";
  const todayLine = dark ? "#9aa3b2" : "#6a7385";
  const tipBg = dark ? "#1a1f29" : "#ffffff";
  const tipBorder = dark ? "#2c313d" : "#e2e5ef";
  const tipText = dark ? "#eef1f7" : "#1b2130";
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
            className="smallcaps text-ink-mute hover:text-ink bg-surface-2 transition-all duration-150 active:scale-95 px-3 py-1.5 rounded-full"
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
            className="smallcaps text-ink-mute hover:text-ink bg-surface-2 transition-all duration-150 active:scale-95 px-3 py-1.5 rounded-full"
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
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: spendColor }} />
          Cumulative
        </span>
        {isCurrentMonth && (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: projColor }}
            />
            Projected
          </span>
        )}
      </div>

      <div className="card mt-4 p-3 sm:p-5">
      <div className="h-[200px] sm:h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartDataWithGhost} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={spendColor} stopOpacity={0.35} />
                <stop offset="100%" stopColor={spendColor} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="projFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={projColor} stopOpacity={0.18} />
                <stop offset="100%" stopColor={projColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={gridStroke} vertical={false} />
            <XAxis
              dataKey="day"
              stroke={gridStroke}
              tick={{ fill: axisTick, fontFamily: "Plus Jakarta Sans", fontSize: 11 }}
              tickLine={false}
            />
            <YAxis
              stroke={gridStroke}
              tickFormatter={yAxisTick}
              tick={{ fill: axisTick, fontFamily: "JetBrains Mono", fontSize: 11 }}
              tickLine={false}
              width={72}
              domain={[0, maxGhost]}
            />
            <Tooltip
              contentStyle={{
                background: tipBg,
                border: `1px solid ${tipBorder}`,
                borderRadius: 14,
                fontFamily: "Plus Jakarta Sans",
                color: tipText,
                boxShadow: "var(--shadow-card)",
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
                stroke={todayLine}
                strokeDasharray="4 4"
                label={{
                  value: "Today",
                  fill: todayLine,
                  fontSize: 10,
                  position: "insideTopRight",
                }}
              />
            )}
            <Area
              type="monotone"
              dataKey="GhostProjection"
              stroke={projColor}
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
              stroke={spendColor}
              strokeWidth={2}
              fill="url(#cumFill)"
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      </div>

      <SectionTitle>Heatmap</SectionTitle>
      <div className="grid grid-cols-7 gap-[2px] sm:gap-[3px]">
        {days.map((d) => {
          const ratio = toNumber(d.expense) / maxExp;
          // Empty days read as a faint recessed well; spend tints toward the
          // Activity green, deepening with the day's share of the month's peak.
          const bg =
            ratio === 0
              ? dark
                ? "rgba(154, 163, 178, 0.06)"
                : "rgba(106, 115, 133, 0.06)"
              : dark
                ? `rgba(132, 201, 147, ${0.14 + ratio * 0.7})`
                : `rgba(63, 143, 87, ${0.14 + ratio * 0.72})`;
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
              className="aspect-square relative rounded-lg border border-paper-rule p-1 cursor-pointer transition-all duration-150 active:scale-95 hover:outline hover:outline-1 hover:outline-[var(--section-edge)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--section-edge)]"
              style={{ backgroundColor: bg }}
            >
              <span
                className={`text-[10px] smallcaps ${
                  ratio > 0.5 ? "text-white" : "text-ink-mute"
                }`}
              >
                {d.day}
              </span>
              {ratio > 0 && (
                <span
                  className={`absolute inset-x-1 bottom-1 num text-[10px] ${
                    ratio > 0.5 ? "text-white" : "text-ink"
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
