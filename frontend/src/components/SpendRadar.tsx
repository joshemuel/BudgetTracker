import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { api } from "@/api";
import type { CategoryStats, CurrencyCode } from "@/types";
import { fmtCompactMoney, fmtShort, todayISO, toNumber } from "@/lib/format";
import { useAmountVisibility } from "@/lib/privacy";
import { withCurrency } from "@/lib/preferences";
import { useSkin, useTheme } from "@/lib/theme";

// Chart colours can't ride CSS variables (Recharts writes SVG presentation
// attributes), so mirror each skin's palette per theme here.
const COLORS = {
  pastel: {
    light: {
      grid: "#e2e5ef",
      angle: "#6a7385",
      radius: "#9aa3b2",
      current: "#2f6fae",
      previous: "#9aa3b2",
      tip: "#ffffff",
      tipBorder: "#e2e5ef",
      tipText: "#1b2130",
    },
    dark: {
      grid: "#2c313d",
      angle: "#9aa3b2",
      radius: "#6a7385",
      current: "#82b7df",
      previous: "#6a7385",
      tip: "#1a1f29",
      tipBorder: "#2c313d",
      tipText: "#eef1f7",
    },
  },
  editorial: {
    light: {
      grid: "#d9cdb4",
      angle: "#4a4437",
      radius: "#877e6a",
      current: "#a02a1a",
      previous: "#877e6a",
      tip: "#f5efe3",
      tipBorder: "#19170f",
      tipText: "#19170f",
    },
    dark: {
      grid: "#4a4130",
      angle: "#d2c9b2",
      radius: "#a59a80",
      current: "#f08a66",
      previous: "#a59a80",
      tip: "#242019",
      tipBorder: "#4a4130",
      tipText: "#f4ecdb",
    },
  },
} as const;

type Granularity = "monthly" | "weekly" | "daily";

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function firstDayISO(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function lastDayISO(year: number, month: number): string {
  const day = new Date(year, month, 0).getDate(); // day 0 of next month = last of this
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

type Ranges = {
  thisFrom: string;
  thisTo: string;
  lastFrom: string;
  lastTo: string;
  curLabel: string;
  prevLabel: string;
  heading: string;
};

/**
 * The compared windows per granularity. The backend `/stats/categories` accepts
 * an arbitrary `from`/`to` range, so weekly/daily need no API change — only the
 * date math here. Weeks start Monday.
 */
function buildRanges(granularity: Granularity, year: number, month: number): Ranges {
  if (granularity === "weekly") {
    const now = new Date();
    const dow = (now.getDay() + 6) % 7; // Monday = 0
    const thisMon = new Date(now);
    thisMon.setDate(now.getDate() - dow);
    const lastMon = new Date(thisMon);
    lastMon.setDate(thisMon.getDate() - 7);
    const lastSun = new Date(thisMon);
    lastSun.setDate(thisMon.getDate() - 1);
    return {
      thisFrom: isoOf(thisMon),
      thisTo: todayISO(),
      lastFrom: isoOf(lastMon),
      lastTo: isoOf(lastSun),
      curLabel: "This week",
      prevLabel: "Last week",
      heading: "Spending shape · this vs last week",
    };
  }
  if (granularity === "daily") {
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    return {
      thisFrom: todayISO(),
      thisTo: todayISO(),
      lastFrom: isoOf(yest),
      lastTo: isoOf(yest),
      curLabel: "Today",
      prevLabel: "Yesterday",
      heading: "Spending shape · today vs yesterday",
    };
  }
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return {
    thisFrom: firstDayISO(year, month),
    thisTo: todayISO(),
    lastFrom: firstDayISO(prevYear, prevMonth),
    lastTo: lastDayISO(prevYear, prevMonth),
    curLabel: "This month",
    prevLabel: "Last month",
    heading: "Spending shape · this vs last month",
  };
}

/**
 * Mobile Overview: a radar comparing the current period's category spend against
 * the previous one, so the *shape* of spending reads at a glance. A dropdown
 * switches the comparison between month / week / day. Each ring is labelled with
 * a whole-number amount so spend is legible without tapping.
 * `year`/`month` are the Overview's UTC reporting month (used for monthly mode).
 */
export default function SpendRadar({
  currency,
  year,
  month,
}: {
  currency: CurrencyCode;
  year: number;
  month: number;
}) {
  const { showAmounts } = useAmountVisibility();
  const { theme } = useTheme();
  const { skin } = useSkin();
  const c = COLORS[skin === "pastel" ? "pastel" : "editorial"][theme === "dark" ? "dark" : "light"];
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const r = buildRanges(granularity, year, month);

  const { data: thisData } = useQuery<CategoryStats>({
    queryKey: ["category-stats", r.thisFrom, r.thisTo, currency],
    queryFn: () =>
      api.get<CategoryStats>(withCurrency(`/stats/categories?from=${r.thisFrom}&to=${r.thisTo}`, currency)),
  });
  const { data: lastData } = useQuery<CategoryStats>({
    queryKey: ["category-stats", r.lastFrom, r.lastTo, currency],
    queryFn: () =>
      api.get<CategoryStats>(withCurrency(`/stats/categories?from=${r.lastFrom}&to=${r.lastTo}`, currency)),
  });

  const reportCurrency = thisData?.currency ?? currency;
  const thisByName = new Map<string, number>();
  const lastByName = new Map<string, number>();
  for (const c of thisData?.categories ?? [])
    if (toNumber(c.expense) > 0) thisByName.set(c.category_name, toNumber(c.expense));
  for (const c of lastData?.categories ?? [])
    if (toNumber(c.expense) > 0) lastByName.set(c.category_name, toNumber(c.expense));

  const names = Array.from(new Set([...thisByName.keys(), ...lastByName.keys()]));
  names.sort(
    (a, b) =>
      (thisByName.get(b) ?? 0) +
      (lastByName.get(b) ?? 0) -
      ((thisByName.get(a) ?? 0) + (lastByName.get(a) ?? 0))
  );
  const chartData = names.slice(0, 6).map((name) => ({
    category: name,
    current: thisByName.get(name) ?? 0,
    previous: lastByName.get(name) ?? 0,
  }));

  const enough = chartData.length >= 3; // a radar needs ≥3 axes to read as a shape

  return (
    <div className="border-t border-paper-rule pt-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="smallcaps text-ink-mute">{r.heading}</p>
        <select
          value={granularity}
          onChange={(e) => setGranularity(e.target.value as Granularity)}
          className="rounded-full border border-paper-rule bg-surface px-3 py-1.5 smallcaps text-ink-soft"
          aria-label="Comparison period"
        >
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
          <option value="daily">Daily</option>
        </select>
      </div>

      {enough ? (
        <>
          <div className="h-[280px] lg:h-[380px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart
                data={chartData}
                outerRadius="72%"
                margin={{ top: 16, right: 36, bottom: 16, left: 36 }}
              >
                <PolarGrid stroke={c.grid} strokeOpacity={0.7} />
                <PolarAngleAxis
                  dataKey="category"
                  tick={({ x, y, textAnchor, payload }: {
                    x: number;
                    y: number;
                    textAnchor: "start" | "middle" | "end" | "inherit";
                    payload: { value: string };
                  }) => {
                    const label =
                      payload.value.length > 11
                        ? payload.value.slice(0, 10) + "…"
                        : payload.value;
                    return (
                      <text
                        x={x}
                        y={y}
                        textAnchor={textAnchor}
                        dominantBaseline="central"
                        fill={c.angle}
                        fontSize={10}
                        fontFamily="Plus Jakarta Sans"
                      >
                        {label}
                      </text>
                    );
                  }}
                />
                {showAmounts && (
                  <PolarRadiusAxis
                    angle={90}
                    tickCount={4}
                    axisLine={false}
                    tick={{ fill: c.radius, fontSize: 8, fontFamily: "JetBrains Mono" }}
                    tickFormatter={(v: number) => fmtShort(Math.round(v), reportCurrency)}
                  />
                )}
                <Radar
                  name={r.prevLabel}
                  dataKey="previous"
                  stroke={c.previous}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  fill={c.previous}
                  fillOpacity={0.04}
                  dot={false}
                  isAnimationActive={false}
                />
                <Radar
                  name={r.curLabel}
                  dataKey="current"
                  stroke={c.current}
                  strokeWidth={2}
                  fill={c.current}
                  fillOpacity={0.22}
                  dot={{ r: 2.5, fill: c.current, stroke: "none" }}
                  isAnimationActive={false}
                />
                {showAmounts && (
                  <Tooltip
                    contentStyle={{
                      background: c.tip,
                      border: `1px solid ${c.tipBorder}`,
                      borderRadius: 12,
                      fontFamily: "Plus Jakarta Sans",
                      fontSize: 12,
                      color: c.tipText,
                    }}
                    itemStyle={{ color: c.tipText }}
                    labelStyle={{ color: c.tipText }}
                    formatter={(v: number, name: string) => [fmtCompactMoney(v, reportCurrency), name]}
                  />
                )}
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex items-center gap-4 smallcaps text-ink-mute">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: c.current }} />
              {r.curLabel}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-0 border-t-2"
                style={{ borderColor: c.previous, borderStyle: "dashed" }}
              />
              {r.prevLabel}
            </span>
          </div>
        </>
      ) : (
        <p className="text-ink-mute text-sm py-12 text-center">
          Not enough data yet to chart a spending shape — log a few more categories.
        </p>
      )}
    </div>
  );
}
