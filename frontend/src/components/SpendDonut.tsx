import { useQuery } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { api } from "@/api";
import type { CategoryStats, CurrencyCode } from "@/types";
import { fmtCompactMoney, fmtPct, todayISO, toNumber } from "@/lib/format";
import { useAmountVisibility } from "@/lib/privacy";
import { withCurrency } from "@/lib/preferences";
import { PALETTE } from "@/pages/Categories";

/**
 * Mobile Overview hero: this month's spend as a donut with a compact legend.
 * Reuses the shared category palette and the /stats/categories endpoint.
 * Renders nothing when there's no spend yet (the figures above still stand).
 * `year`/`month` come from the Overview's UTC reporting month so the range
 * lines up exactly with the figures above it.
 */
export default function SpendDonut({
  currency,
  year,
  month,
}: {
  currency: CurrencyCode;
  year: number;
  month: number;
}) {
  const { showAmounts } = useAmountVisibility();
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = todayISO();

  const { data } = useQuery<CategoryStats>({
    queryKey: ["category-stats", from, to, currency],
    queryFn: () =>
      api.get<CategoryStats>(withCurrency(`/stats/categories?from=${from}&to=${to}`, currency)),
  });
  const reportCurrency = data?.currency ?? currency;

  const rows = (data?.categories ?? []).filter((c) => toNumber(c.expense) > 0);
  const total = rows.reduce((a, r) => a + toNumber(r.expense), 0);
  const pieData = rows.slice(0, 8).map((r) => ({
    name: r.category_name,
    value: toNumber(r.expense),
  }));
  const legend = rows.slice(0, 5);

  if (rows.length === 0) return null;

  return (
    <div className="border-t-2 border-ink pt-3">
      <p className="smallcaps text-ink-mute">Where it went</p>
      <div className="relative h-[180px] mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              innerRadius={56}
              outerRadius={82}
              stroke="#f5efe3"
              strokeWidth={1}
              startAngle={90}
              endAngle={-270}
            >
              {pieData.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="smallcaps text-ink-mute">Spent</span>
          <span className="num text-lg">
            {showAmounts ? fmtCompactMoney(total, reportCurrency) : "••••••"}
          </span>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {legend.map((r, i) => {
          const share = total ? toNumber(r.expense) / total : 0;
          return (
            <li key={r.category_id} className="flex items-center gap-2 text-[12px]">
              <span
                className="inline-block w-2.5 h-2.5 shrink-0"
                style={{ background: PALETTE[i % PALETTE.length] }}
              />
              <span className="flex-1 min-w-0 truncate font-[450]">{r.category_name}</span>
              <span className="num text-ink-mute">{fmtPct(share)}</span>
              <span className="num text-accent w-20 text-right">
                {showAmounts ? fmtCompactMoney(r.expense, reportCurrency) : "••••••"}
              </span>
            </li>
          );
        })}
        {rows.length > legend.length && (
          <li className="text-[11px] text-ink-mute pl-[18px]">
            +{rows.length - legend.length} more
          </li>
        )}
      </ul>
    </div>
  );
}
