import { useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
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
import type { CurrencyCode, Me, Monthly } from "@/types";
import { fmtCompactMoney, fmtMoney, fmtShort, monthName, toNumber } from "@/lib/format";
import { SectionTitle } from "@/components/Figure";
import { useAmountVisibility } from "@/lib/privacy";
import { useIsMobile } from "@/lib/mediaQuery";
import { preferredCurrency, withCurrency } from "@/lib/preferences";
import { useSkin, useTheme } from "@/lib/theme";
import { paletteFor } from "@/pages/Categories";
import CategoryBreakdownModal from "@/components/CategoryBreakdownModal";

// How many top categories to draw individually before bundling the rest into
// an "Other" segment, so each monthly bar stays readable.
const TOP_CATEGORIES = 8;

function toISO(y: number, m: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Round a value up to a "nice" axis maximum (1/2/2.5/5/10 × 10ⁿ). On mobile the
// chart scrolls horizontally, so the real YAxis scrolls out of view; we pin a
// duplicate axis over the left edge. Both share this fixed domain so their ticks
// land at identical heights and the pinned copy reads true for every month.
function niceCeil(v: number): number {
  if (!isFinite(v) || v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / pow;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * pow;
}

// Explicit numeric fields win over the index signature, so totals/arithmetic
// stay typed as `number` while the dynamic `inc_<id>`/`exp_<id>` category keys
// can still be assigned.
type ChartRow = {
  name: string;
  month: number;
  Income: number;
  Expense: number;
  Net: number;
  [key: string]: number | string;
};

// Recharts clones this into the chart and injects `active`/`payload`; we keep
// the rest of the props bound from the page so it can format amounts. Shows the
// hovered month's income/expense totals (works in plain and by-category modes).
function TotalsTooltip({
  active,
  payload,
  showAmounts,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
  showAmounts: boolean;
  currency: CurrencyCode;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-2xl border border-paper-rule bg-surface px-3 py-2 text-[12px] shadow-card">
      <p className="smallcaps text-ink-mute mb-1">{monthName(Number(row.month))}</p>
      <p className="num text-gain">
        In · {showAmounts ? fmtMoney(Number(row.Income), currency) : "••••••"}
      </p>
      <p className="num text-accent">
        Out · {showAmounts ? fmtMoney(Number(row.Expense), currency) : "••••••"}
      </p>
    </div>
  );
}

export default function MonthlyPage() {
  const { showAmounts } = useAmountVisibility();
  const [year, setYear] = useState(new Date().getFullYear());
  const [byCategory, setByCategory] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Long-press (mobile) shows a small in/out box for the held bar, mirroring the
  // desktop hover tooltip; a short tap still opens the spending pie.
  const chartBoxRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<number | null>(null);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressedRef = useRef(false);
  const movedRef = useRef(false);
  const [pressBox, setPressBox] = useState<{ index: number; x: number; y: number } | null>(null);
  const { theme } = useTheme();
  const { skin } = useSkin();
  const dark = theme === "dark";
  const editorial = skin !== "pastel";
  const palette = paletteFor(skin, dark);
  // Chart chrome colours, branched on skin × theme. Income is the gain green,
  // expense the accent rust; "Other" is a neutral gray that never competes.
  const gridStroke = editorial ? (dark ? "#4a4130" : "#d9cdb4") : dark ? "#2c313d" : "#e2e5ef";
  const axisTick = editorial ? (dark ? "#d2c9b2" : "#4a4437") : dark ? "#9aa3b2" : "#6a7385";
  const incomeColor = editorial ? (dark ? "#abcb80" : "#3f5d2e") : dark ? "#7fd6a0" : "#2e7d4f";
  const expenseColor = editorial ? (dark ? "#f08a66" : "#a02a1a") : dark ? "#f0876a" : "#c43d24";
  const otherColor = editorial ? (dark ? "#a59a80" : "#877e6a") : dark ? "#6a7385" : "#9aa3b2";
  const { data: me } = useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/auth/me"),
  });
  const currency = preferredCurrency(me);

  const { data } = useQuery<Monthly>({
    queryKey: ["monthly", year, currency, byCategory],
    queryFn: () =>
      api.get<Monthly>(
        withCurrency(
          `/stats/monthly?year=${year}${byCategory ? "&breakdown=category" : ""}`,
          currency
        )
      ),
  });
  const reportCurrency = data?.currency ?? currency;

  const isMobile = useIsMobile();
  const fmtAmount = (v: string | number) =>
    showAmounts
      ? isMobile
        ? fmtCompactMoney(v, reportCurrency)
        : fmtMoney(v, reportCurrency)
      : "••••••";

  const masked = (value: string) =>
    showAmounts ? value : <span className="masked-amount">••••••</span>;

  // Top categories (already sorted by yearly total server-side); the rest get
  // folded into an "Other" segment so the stacks don't sprout 18 colours.
  const topCats = (data?.categories ?? []).slice(0, TOP_CATEGORIES);
  const colorFor = (idx: number) => palette[idx % palette.length];

  const chartData: ChartRow[] =
    data?.months.map((m): ChartRow => {
      const row: ChartRow = {
        name: monthName(m.month, true),
        month: m.month,
        Income: toNumber(m.income),
        Expense: toNumber(m.expense),
        Net: toNumber(m.net),
      };
      if (byCategory) {
        const byId = new Map((m.categories ?? []).map((c) => [c.category_id, c]));
        let incOther = toNumber(m.income);
        let expOther = toNumber(m.expense);
        topCats.forEach((tc) => {
          const c = byId.get(tc.category_id);
          const inc = toNumber(c?.income);
          const exp = toNumber(c?.expense);
          row[`inc_${tc.category_id}`] = inc;
          row[`exp_${tc.category_id}`] = exp;
          incOther -= inc;
          expOther -= exp;
        });
        row.inc_other = Math.max(0, incOther);
        row.exp_other = Math.max(0, expOther);
      }
      return row;
    }) ?? [];

  // Fixed Y domain shared by the chart and the pinned mobile axis. Each bar
  // (or stack, in category mode) tops out at that month's income or expense, so
  // the tallest of those across the year sets the ceiling.
  const rawYMax = chartData.reduce(
    (mx, r) => Math.max(mx, Number(r.Income), Number(r.Expense)),
    0,
  );
  const yDomainMax = niceCeil(rawYMax);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const isFuture = (m: number) =>
    year > currentYear || (year === currentYear && m > currentMonth);

  const totals = chartData.reduce(
    (acc, r) => ({
      income: acc.income + Number(r.Income),
      expense: acc.expense + Number(r.Expense),
    }),
    { income: 0, expense: 0 }
  );

  // Date range for the spending-division pop-up: the clicked month.
  const pieFrom = selectedMonth ? toISO(year, selectedMonth, 1) : "";
  const pieTo = selectedMonth
    ? toISO(year, selectedMonth, new Date(year, selectedMonth, 0).getDate())
    : "";

  // Which bar sits under a touch X. The chart has left/right margins of 0 and a
  // 72px YAxis, so the plot starts 72px in; map the rest evenly across the months.
  const clearPressTimer = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  const indexFromTouch = (clientX: number): number | null => {
    const el = chartBoxRef.current;
    if (!el || chartData.length === 0) return null;
    const rect = el.getBoundingClientRect();
    const plotLeft = 72;
    const plotW = rect.width - plotLeft;
    if (plotW <= 0) return null;
    const i = Math.floor(((clientX - rect.left - plotLeft) / plotW) * chartData.length);
    return i < 0 || i >= chartData.length ? null : i;
  };
  const handleTouchStart = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    longPressedRef.current = false;
    movedRef.current = false;
    pressStartRef.current = { x: t.clientX, y: t.clientY };
    const { clientX, clientY } = t;
    clearPressTimer();
    pressTimer.current = window.setTimeout(() => {
      const idx = indexFromTouch(clientX);
      if (idx == null) return;
      longPressedRef.current = true;
      setPressBox({ index: idx, x: clientX, y: clientY });
    }, 450);
  };
  const handleTouchMove = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    const start = pressStartRef.current;
    if (!t || !start) return;
    if (longPressedRef.current) {
      const idx = indexFromTouch(t.clientX);
      if (idx != null) setPressBox({ index: idx, x: t.clientX, y: t.clientY });
      return;
    }
    if (Math.abs(t.clientX - start.x) > 8 || Math.abs(t.clientY - start.y) > 8) {
      movedRef.current = true;
      clearPressTimer();
    }
  };
  const handleTouchEnd = () => {
    clearPressTimer();
    pressStartRef.current = null;
    setPressBox(null);
  };

  // Tidy the pending long-press timer if the page unmounts mid-hold.
  useEffect(() => () => clearPressTimer(), []);

  // On mobile, open the year scrolled so the current month sits in view rather
  // than starting at January. Runs once the bars have laid out (rAF) and again
  // when the chart width can change (category toggle) or data arrives.
  useEffect(() => {
    if (!isMobile || year !== currentYear) return;
    const el = scrollRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      const overflow = el.scrollWidth - el.clientWidth;
      if (overflow <= 0) return;
      el.scrollLeft = overflow * ((currentMonth - 0.5) / 12);
    });
    return () => cancelAnimationFrame(raf);
  }, [isMobile, byCategory, year, currentYear, currentMonth, chartData.length]);

  return (
    <div>
      <div className="flex items-end justify-between">
        <SectionTitle>{year}</SectionTitle>
        <div className="flex items-center gap-4">
          <button
            type="button"
            role="switch"
            aria-checked={byCategory}
            onClick={() => setByCategory((v) => !v)}
            className="flex items-center gap-1.5 cursor-pointer select-none active:scale-95 transition-transform duration-150"
            title="Toggle per-category breakdown"
          >
            <span className="smallcaps text-[10px] text-ink-mute whitespace-nowrap">
              By category
            </span>
            <span
              className={`relative inline-flex h-3.5 w-7 shrink-0 items-center rounded-full transition-colors duration-150 ${
                byCategory ? "bg-[var(--section-edge)]" : "bg-paper-deep"
              }`}
            >
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full bg-surface shadow-sm transition-transform duration-150 ${
                  byCategory ? "translate-x-[16px]" : "translate-x-[2px]"
                }`}
              />
            </span>
          </button>
        <div className="flex gap-1.5 smallcaps">
          {[year - 2, year - 1, year, year + 1].map((y) => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={
                "rounded-full px-3 py-1 transition-all duration-150 active:scale-95 " +
                (y === year
                  ? "bg-[var(--section-edge)] text-white"
                  : "bg-surface-2 text-ink-mute hover:text-ink")
              }
            >
              {y}
            </button>
          ))}
        </div>
        </div>
      </div>

      <div className="card grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 p-5 sm:p-6 mt-2">
        <div>
          <p className="smallcaps text-ink-mute">YTD In</p>
          <p className="num text-[2.5rem] leading-[0.95] sm:text-2xl sm:leading-none mt-1 break-words text-gain">
            {masked(fmtAmount(totals.income))}
          </p>
        </div>
        <div>
          <p className="smallcaps text-ink-mute">YTD Out</p>
          <p className="num text-[2.5rem] leading-[0.95] sm:text-2xl sm:leading-none mt-1 break-words text-accent">
            {masked(fmtAmount(totals.expense))}
          </p>
        </div>
        <div>
          <p className="smallcaps text-ink-mute">YTD Net</p>
          <p
            className={`num text-[2.5rem] leading-[0.95] sm:text-2xl sm:leading-none mt-1 break-words ${
              totals.income - totals.expense >= 0 ? "text-gain" : "text-accent"
            }`}
          >
            {masked(fmtAmount(totals.income - totals.expense))}
          </p>
        </div>
      </div>

      {/* relative wrapper hosts the horizontal scroller plus, on mobile, a
          pinned axis overlaid on its left edge. */}
      <div className="card mt-6 relative p-3 sm:p-5 overflow-hidden">
      <div
        ref={scrollRef}
        className="overflow-x-auto -mx-2 px-2 sm:mx-0 sm:px-0"
        data-tutorial="monthly-chart"
      >
        <div
          ref={chartBoxRef}
          className="h-[240px] sm:h-[360px] select-none"
          style={isMobile ? { minWidth: 680, touchAction: "pan-x" } : undefined}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onContextMenu={(e) => e.preventDefault()}
        >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 0, left: 0, bottom: 0 }}
            onClick={(next) => {
              // A long-press (in/out box) or a scroll must not also open the pie.
              if (longPressedRef.current || movedRef.current) {
                longPressedRef.current = false;
                movedRef.current = false;
                return;
              }
              const idx = (next as { activeTooltipIndex?: number | null })
                .activeTooltipIndex;
              if (idx == null || idx < 0 || idx >= chartData.length) return;
              setSelectedMonth(Number(chartData[idx].month));
            }}
            className="cursor-pointer"
          >
            <CartesianGrid stroke={gridStroke} vertical={false} />
            <XAxis
              dataKey="name"
              stroke={gridStroke}
              interval={0}
              tick={{ fill: axisTick, fontFamily: "Plus Jakarta Sans", fontSize: 11 }}
              tickLine={false}
              // Fixed height on mobile so the plot area matches the pinned axis.
              height={isMobile ? 28 : undefined}
            />
            <YAxis
              stroke={gridStroke}
              tick={{ fill: axisTick, fontFamily: "JetBrains Mono", fontSize: 11 }}
              tickFormatter={(v) => (showAmounts ? fmtShort(v, reportCurrency) : "•••")}
              tickLine={false}
              width={72}
              // Mobile: lock the domain so the pinned overlay axis reads true.
              domain={isMobile ? [0, yDomainMax] : undefined}
            />
              {/* Desktop hover shows the month's income/expense totals in both
                  plain and by-category modes (the stacked segments alone don't
                  reveal the totals). */}
              {!isMobile && (
                <Tooltip
                  content={<TotalsTooltip showAmounts={showAmounts} currency={reportCurrency} />}
                  cursor={{ fill: dark ? "rgba(154,163,178,0.12)" : "rgba(106,115,133,0.10)" }}
                />
              )}
            {byCategory ? (
              <>
                {topCats.map((tc, i) => (
                  <Bar
                    key={`inc_${tc.category_id}`}
                    dataKey={`inc_${tc.category_id}`}
                    stackId="income"
                    name={tc.name}
                    fill={colorFor(i)}
                    fillOpacity={1}
                  />
                ))}
                <Bar
                  dataKey="inc_other"
                  stackId="income"
                  name="Other"
                  fill={otherColor}
                  fillOpacity={1}
                  legendType="none"
                />
                {topCats.map((tc, i) => (
                  <Bar
                    key={`exp_${tc.category_id}`}
                    dataKey={`exp_${tc.category_id}`}
                    stackId="expense"
                    name={tc.name}
                    fill={colorFor(i)}
                    fillOpacity={1}
                    legendType="none"
                  />
                ))}
                <Bar
                  dataKey="exp_other"
                  stackId="expense"
                  name="Other"
                  fill={otherColor}
                  fillOpacity={1}
                  legendType="none"
                />
              </>
            ) : (
              <>
                <Bar dataKey="Income" radius={[6, 6, 0, 0]}>
                  {chartData.map((row) => (
                    <Cell
                      key={`inc-${row.month}`}
                      fill={isFuture(Number(row.month)) ? "transparent" : incomeColor}
                      stroke={isFuture(Number(row.month)) ? incomeColor : "none"}
                      strokeDasharray={isFuture(Number(row.month)) ? "2 2" : undefined}
                      strokeOpacity={isFuture(Number(row.month)) ? 0.35 : 1}
                    />
                  ))}
                </Bar>
                <Bar dataKey="Expense" radius={[6, 6, 0, 0]}>
                  {chartData.map((row) => (
                    <Cell
                      key={`exp-${row.month}`}
                      fill={isFuture(Number(row.month)) ? "transparent" : expenseColor}
                      stroke={isFuture(Number(row.month)) ? expenseColor : "none"}
                      strokeDasharray={isFuture(Number(row.month)) ? "2 2" : undefined}
                      strokeOpacity={isFuture(Number(row.month)) ? 0.35 : 1}
                    />
                  ))}
                </Bar>
              </>
            )}
          </BarChart>
        </ResponsiveContainer>
        </div>
      </div>
        {/* Pinned axis: the same chart laid out at full width but clipped to the
            72px left gutter and made opaque, so bars scrolling under it are
            masked while the axis stays put. Identical height, margins, XAxis
            spacer and domain as the real chart → its ticks line up exactly.
            The scroller's -mx-2 lets bars slide 8px past the wrapper's left
            edge, so the mask starts at -left-2 (marginLeft puts the axis chart
            back at wrapper x=0). */}
        {isMobile && (
          <div className="absolute top-3 left-1 h-[240px] w-[80px] overflow-hidden bg-surface pointer-events-none">
            <div style={{ width: 680, height: "100%", marginLeft: 8 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="name"
                    height={28}
                    tick={false}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    stroke={gridStroke}
                    tick={{ fill: axisTick, fontFamily: "JetBrains Mono", fontSize: 11 }}
                    tickFormatter={(v) => (showAmounts ? fmtShort(v, reportCurrency) : "•••")}
                    tickLine={false}
                    width={72}
                    domain={[0, yDomainMax]}
                  />
                  <Bar dataKey="Income" fill="transparent" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
      <p className="smallcaps text-[10px] text-ink-mute mt-2">
        Tap a bar to see that month's spending breakdown{isMobile ? " · hold for in vs out" : ""}.
      </p>

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
                <td className="font-[550]">{monthName(m.month)}</td>
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

      <CategoryBreakdownModal
        open={selectedMonth !== null}
        title={selectedMonth ? `${monthName(selectedMonth)} ${year} · spending` : ""}
        from={pieFrom}
        to={pieTo}
        currency={reportCurrency}
        onClose={() => setSelectedMonth(null)}
      />

      {isMobile && pressBox && chartData[pressBox.index] && (
        <div
          className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full rounded-2xl border border-paper-rule bg-surface px-3 py-2 shadow-card"
          style={{
            left: Math.min(
              Math.max(pressBox.x, 92),
              (typeof window !== "undefined" ? window.innerWidth : 360) - 92
            ),
            top: pressBox.y - 12,
          }}
        >
          <p className="smallcaps text-ink-mute text-[10px] leading-none mb-1">
            {monthName(Number(chartData[pressBox.index].month))}
          </p>
          <div className="flex items-baseline justify-between gap-5 text-[12px]">
            <span className="smallcaps text-ink-mute">In</span>
            <span className="num text-gain">
              {showAmounts
                ? fmtCompactMoney(Number(chartData[pressBox.index].Income), reportCurrency)
                : "••••••"}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-5 text-[12px]">
            <span className="smallcaps text-ink-mute">Out</span>
            <span className="num text-accent">
              {showAmounts
                ? fmtCompactMoney(Number(chartData[pressBox.index].Expense), reportCurrency)
                : "••••••"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
