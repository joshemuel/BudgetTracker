import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { Category, Source, Transaction } from "@/types";
import { fmtDateTime, fmtMoney, toNumber } from "@/lib/format";
import { SectionTitle } from "@/components/Figure";

const CURRENCY_BY_SOURCE: Record<number, "IDR" | "SGD" | "JPY" | "AUD"> = {};

export default function TransactionsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [sourceId, setSourceId] = useState<number | "">("");
  const [limit, setLimit] = useState(100);

  const { data: cats } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories"),
  });
  const { data: srcs } = useQuery<Source[]>({
    queryKey: ["sources"],
    queryFn: () => api.get<Source[]>("/sources"),
  });

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", String(limit));
    if (categoryId) p.set("category_id", String(categoryId));
    if (sourceId) p.set("source_id", String(sourceId));
    if (q) p.set("q", q);
    return p.toString();
  }, [q, categoryId, sourceId, limit]);

  const { data: txs } = useQuery<Transaction[]>({
    queryKey: ["transactions", qs],
    queryFn: () => api.get<Transaction[]>(`/transactions?${qs}`),
  });

  const del = useMutation({
    mutationFn: (id: number) => api.del(`/transactions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["sources"] });
    },
  });

  return (
    <div>
      <SectionTitle kicker="The running register">Transactions</SectionTitle>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 border-b border-paper-rule pb-4">
        <label className="block">
          <span className="smallcaps text-ink-mute">Search</span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="description…"
            className="mt-1 w-full bg-transparent border-b border-ink py-1"
          />
        </label>
        <label className="block">
          <span className="smallcaps text-ink-mute">Category</span>
          <select
            value={categoryId}
            onChange={(e) =>
              setCategoryId(e.target.value ? Number(e.target.value) : "")
            }
            className="mt-1 w-full bg-transparent border-b border-ink py-1"
          >
            <option value="">All</option>
            {cats?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="smallcaps text-ink-mute">Source</span>
          <select
            value={sourceId}
            onChange={(e) =>
              setSourceId(e.target.value ? Number(e.target.value) : "")
            }
            className="mt-1 w-full bg-transparent border-b border-ink py-1"
          >
            <option value="">All</option>
            {srcs?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="smallcaps text-ink-mute">Rows</span>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="mt-1 w-full bg-transparent border-b border-ink py-1"
          >
            {[50, 100, 250, 500].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <table className="ledger-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Description</th>
            <th>Category</th>
            <th>Source</th>
            <th className="text-right">Amount</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {txs?.map((t) => (
            <tr key={t.id}>
              <td className="num text-ink-soft text-sm">{fmtDateTime(t.occurred_at)}</td>
              <td className="font-[450]">
                {t.description || <span className="text-ink-mute italic">—</span>}
                {t.transfer_group_id && (
                  <span className="ml-2 smallcaps text-ink-mute">transfer</span>
                )}
              </td>
              <td>{t.category_name}</td>
              <td className="text-ink-soft">{t.source_name}</td>
              <td
                className={`text-right num ${
                  t.type === "expense" ? "text-accent" : "text-gain"
                }`}
              >
                {t.type === "expense" ? "−" : "+"}
                {(() => {
                  if (srcs) {
                    for (const s of srcs) {
                      CURRENCY_BY_SOURCE[s.id] = s.currency;
                    }
                  }
                  const currency = CURRENCY_BY_SOURCE[t.source_id] ?? "IDR";
                  return fmtMoney(toNumber(t.amount), currency);
                })()}
              </td>
              <td className="text-right">
                <button
                  onClick={() => {
                    if (confirm(`Delete this ${t.type}?`)) del.mutate(t.id);
                  }}
                  className="smallcaps text-ink-mute hover:text-accent"
                >
                  delete
                </button>
              </td>
            </tr>
          ))}
          {txs && txs.length === 0 && (
            <tr>
              <td colSpan={6} className="text-center text-ink-mute py-8">
                Nothing to report.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
