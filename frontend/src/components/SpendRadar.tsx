import { useQuery } from "@tanstack/react-query";
import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { api } from "@/api";
import type { CategoryStats, CurrencyCode } from "@/types";
import { fmtCompactMoney, todayISO, toNumber } from "@/lib/format";
import { useAmountVisibility } from "@/lib/privacy";
import { withCurrency } from "@/lib/preferences";

const THIS_COLOR = "#a02a1a"; // accent — this month
const LAST_COLOR = "#877e6a"; // muted ink — last month

function firstDayISO(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function lastDayISO(year: number, month: number): string {
  const day = new Date(year, month, 0).getDate(); // day 0 of next month = last of this
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Mobile Overview: a radar comparing this month's category spend against last
 * month's, so the *shape* of spending (not the raw totals) reads at a glance.
 * Distinct from the "By Category" table/heatmap, which list amounts. Renders
 * nothing until there are at least three categories to form a shape.
 * `year`/`month` are the Overview's UTC reporting month.
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
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  const thisFrom = firstDayISO(year, month);
  const thisTo = todayISO();
  const lastFrom = firstDayISO(prevYear, prevMonth);
  const lastTo = lastDayISO(prevYear, prevMonth);

  const { data: thisData } = useQuery<CategoryStats>({
    queryKey: ["category-stats", thisFrom, thisTo, currency],
    queryFn: () =>
      api.get<CategoryStats>(withCurrency(`/stats/categories?from=${thisFrom}&to=${thisTo}`, currency)),
  });
  const { data: lastData } = useQuery<CategoryStats>({
    queryKey: ["category-stats", lastFrom, lastTo, currency],
    queryFn: () =>
      api.get<CategoryStats>(withCurrency(`/stats/categories?from=${lastFrom}&to=${lastTo}`, currency)),
  });

  const reportCurrency = thisData?.currency ?? currency;
  const thisByName = new Map<string, number>();
  const lastByName = new Map<string, number>();
  for (const c of thisData?.categories ?? [])
    if (toNumber(c.expense) > 0) thisByName.set(c.category_name, toNumber(c.expense));
  for (const c of lastData?.categories ?? [])
    if (toNumber(c.expense) > 0) lastByName.set(c.category_name, toNumber(c.expense));

  const names = Array.from(new Set([...thisByName.keys(), ...lastByName.keys()]));
  if (names.length < 3) return null; // a radar needs ≥3 axes to read as a shape

  names.sort(
    (a, b) =>
      (thisByName.get(b) ?? 0) +
      (lastByName.get(b) ?? 0) -
      ((thisByName.get(a) ?? 0) + (lastByName.get(a) ?? 0))
  );
  const chartData = names.slice(0, 6).map((name) => ({
    category: name,
    "This month": thisByName.get(name) ?? 0,
    "Last month": lastByName.get(name) ?? 0,
  }));

  return (
    <div className="border-t-2 border-ink pt-3">
      <p className="smallcaps text-ink-mute">Spending shape · this vs last month</p>
      <div className="h-[250px] mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={chartData} outerRadius="70%">
            <PolarGrid stroke="#d9cdb4" />
            <PolarAngleAxis
              dataKey="category"
              tick={{ fill: "#4a4437", fontSize: 9, fontFamily: "Instrument Sans" }}
              tickFormatter={(v: string) => (v.length > 9 ? v.slice(0, 8) + "…" : v)}
            />
            <Radar
              name="Last month"
              dataKey="Last month"
              stroke={LAST_COLOR}
              fill={LAST_COLOR}
              fillOpacity={0.12}
              strokeWidth={1}
              isAnimationActive={false}
            />
            <Radar
              name="This month"
              dataKey="This month"
              stroke={THIS_COLOR}
              fill={THIS_COLOR}
              fillOpacity={0.3}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
            {showAmounts && (
              <Tooltip
                contentStyle={{
                  background: "#f5efe3",
                  border: "1px solid #19170f",
                  borderRadius: 0,
                  fontFamily: "Instrument Sans",
                  fontSize: 12,
                }}
                formatter={(v: number, name: string) => [fmtCompactMoney(v, reportCurrency), name]}
              />
            )}
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex items-center gap-4 smallcaps text-ink-mute">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5" style={{ background: THIS_COLOR }} />
          This month
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5" style={{ background: LAST_COLOR }} />
          Last month
        </span>
      </div>
    </div>
  );
}
