import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
} from "recharts";
import { api } from "@/api";
import type { CategoryStats, CurrencyCode, Me } from "@/types";
import { fmtCompactMoney, fmtMoney, fmtPct, todayISO, toNumber } from "@/lib/format";
import { SectionTitle } from "@/components/Figure";
import { useAmountVisibility } from "@/lib/privacy";
import { useIsMobile } from "@/lib/mediaQuery";
import { preferredCurrency, withCurrency } from "@/lib/preferences";
import { useTheme } from "@/lib/theme";

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

// Night-mode palette: the near-black/dark inks above disappear on a dark
// ground, so brighten them while keeping each hue distinct.
export const PALETTE_DARK = [
  "#e2674f",
  "#7fa64f",
  "#d99a3f",
  "#cdbf9e",
  "#9a8f76",
  "#b6ab90",
  "#e08a3f",
  "#bb8a55",
  "#cf6a5e",
  "#5fa48c",
];

// Pick black or near-white text so an in-slice % label stays legible on any
// palette colour (relative-luminance threshold).
function labelColor(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#19170f" : "#f7f1e3";
}

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
  const { theme } = useTheme();
  const dark = theme === "dark";
  const palette = dark ? PALETTE_DARK : PALETTE;
  const sliceGap = dark ? "#1b1813" : "#f5efe3";
  const tipBg = dark ? "#242019" : "#f5efe3";
  const tipBorder = dark ? "#4a4130" : "#19170f";
  const tipText = dark ? "#f4ecdb" : "#19170f";
  const isMobile = useIsMobile();
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);

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

  // Percentage printed inside each slice — the only place phone users can read
  // shares (the mobile list drops the %). Tiny slices are skipped to avoid
  // overlap; the % is a ratio, so it shows even when amounts are hidden.
  const renderPieLabel = (props: {
    cx: number;
    cy: number;
    midAngle: number;
    innerRadius: number;
    outerRadius: number;
    percent: number;
    index: number;
  }) => {
    const { cx, cy, midAngle, innerRadius, outerRadius, percent, index } = props;
    if (percent < 0.06) return null;
    const RAD = Math.PI / 180;
    const r = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + r * Math.cos(-midAngle * RAD);
    const y = cy + r * Math.sin(-midAngle * RAD);
    return (
      <text
        x={x}
        y={y}
        fill={labelColor(palette[index % palette.length])}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Instrument Sans"
        fontWeight={600}
        fontSize={compact && isMobile ? 9 : 11}
      >
        {Math.round(percent * 100)}%
      </text>
    );
  };

  // Tap/hover highlight: enlarge the active slice and draw a thin ink ring just
  // outside it — outlines THAT segment instead of the old rectangular tooltip.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts types activeShape as (props: unknown).
  const renderActiveSector = (props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
    return (
      <g>
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius}
          outerRadius={outerRadius + 6}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
          stroke={sliceGap}
          strokeWidth={1}
        />
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={outerRadius + 7}
          outerRadius={outerRadius + 9}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={dark ? "#f4ecdb" : "#19170f"}
        />
      </g>
    );
  };

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
              stroke={sliceGap}
              strokeWidth={1}
              label={renderPieLabel}
              labelLine={false}
              activeIndex={activeIndex}
              activeShape={renderActiveSector}
              onClick={(_, i) =>
                setActiveIndex((prev) => (prev === i ? undefined : i))
              }
              onMouseEnter={isMobile ? undefined : (_, i) => setActiveIndex(i)}
              onMouseLeave={isMobile ? undefined : () => setActiveIndex(undefined)}
            >
              {pieData.map((_, i) => (
                <Cell key={i} fill={palette[i % palette.length]} />
              ))}
            </Pie>
            {!isMobile && (
              <Tooltip
                contentStyle={{
                  background: tipBg,
                  border: `1px solid ${tipBorder}`,
                  borderRadius: 0,
                  fontFamily: "Instrument Sans",
                  color: tipText,
                }}
                itemStyle={{ color: tipText }}
                labelStyle={{ color: tipText }}
                formatter={(v: number) =>
                  showAmounts ? fmtMoney(v, reportCurrency) : "••••••"
                }
              />
            )}
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="col-span-12 md:col-span-7">
        {compact ? (
          // Pop-up view: a plain swatch + category + amount list (with % on
          // desktop, dropped on phone) rather than the dense 4-column table.
          <ul className="text-[12px] sm:text-[13px]">
            {rows.map((r, i) => {
              const share = total ? toNumber(r.expense) / total : 0;
              return (
                <li
                  key={r.category_id}
                  className="flex items-center gap-2.5 py-1 sm:py-1.5 border-b border-paper-rule last:border-0"
                >
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-[2px] shrink-0"
                    style={{ background: palette[i % palette.length] }}
                  />
                  <span className="font-[550] flex-1 truncate">{r.category_name}</span>
                  <span className="num text-accent text-right whitespace-nowrap">
                    {masked(fmtAmount(r.expense))}
                  </span>
                  {!isMobile && (
                    <span className="num text-ink-mute text-right w-12 shrink-0">
                      {fmtPct(share)}
                    </span>
                  )}
                </li>
              );
            })}
            <li className="flex items-center gap-2.5 pt-2 mt-1 border-t border-ink font-semibold">
              <span className="smallcaps flex-1">Total</span>
              <span className="num text-right whitespace-nowrap">
                {masked(fmtAmount(total))}
              </span>
              {!isMobile && <span className="w-12 shrink-0" />}
            </li>
          </ul>
        ) : (
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
                      <td className="font-[550] flex items-center gap-2">
                        <span
                          className="inline-block w-2 h-2"
                          style={{ background: palette[i % palette.length] }}
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
                <tr className="font-semibold">
                  <td className="smallcaps">Total</td>
                  <td className="text-right num">{masked(fmtAmount(total))}</td>
                  <td></td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
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
      <SectionTitle>By Category</SectionTitle>

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
