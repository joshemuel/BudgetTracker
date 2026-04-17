import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { Category, Source, Transaction, TxType } from "@/types";
import { fmtCompactMoney, fmtDateTime, fmtMoney, toNumber } from "@/lib/format";
import { SectionTitle } from "@/components/Figure";
import ConfirmDialog from "@/components/ConfirmDialog";

type CurrencyCode = "IDR" | "SGD" | "JPY" | "AUD" | "TWD";

function toLocalDateTimeInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function TransactionsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [sourceId, setSourceId] = useState<number | "">("");
  const [limit, setLimit] = useState(100);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [editOccurredAt, setEditOccurredAt] = useState("");
  const [editType, setEditType] = useState<TxType>("expense");
  const [editCategoryId, setEditCategoryId] = useState<number | "">("");
  const [editSourceId, setEditSourceId] = useState<number | "">("");
  const [editAmount, setEditAmount] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null);
  const isMobile = typeof window !== "undefined" ? window.innerWidth < 640 : false;

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

  const currencyBySource = useMemo(() => {
    const m: Record<number, CurrencyCode> = {};
    for (const s of srcs ?? []) {
      m[s.id] = s.currency;
    }
    return m;
  }, [srcs]);

  const del = useMutation({
    mutationFn: (id: number) => api.del(`/transactions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["sources"] });
      setPendingDelete(null);
    },
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api.patch(`/transactions/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["sources"] });
      qc.invalidateQueries({ queryKey: ["monthly"] });
      qc.invalidateQueries({ queryKey: ["daily"] });
      qc.invalidateQueries({ queryKey: ["category-stats"] });
      setEditing(null);
    },
  });

  const canEdit =
    !!editing &&
    editOccurredAt &&
    editAmount !== "" &&
    editCategoryId !== "" &&
    editSourceId !== "" &&
    !patch.isPending;

  return (
    <div>
      <SectionTitle kicker="The running register">Transactions</SectionTitle>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6 border-b border-paper-rule pb-4">
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

      <div className="-mx-2 px-2 sm:mx-0 sm:px-0">
        <table className="ledger-table w-full text-[11px] sm:text-[13px]">
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
                  {isMobile
                    ? fmtCompactMoney(toNumber(t.amount), currencyBySource[t.source_id] ?? "IDR")
                    : fmtMoney(toNumber(t.amount), currencyBySource[t.source_id] ?? "IDR")}
                </td>
                <td className="text-right">
                  <button
                    onClick={() => {
                      setEditing(t);
                      setEditOccurredAt(toLocalDateTimeInput(t.occurred_at));
                      setEditType(t.type);
                      setEditCategoryId(t.category_id);
                      setEditSourceId(t.source_id);
                      setEditAmount(String(toNumber(t.amount)));
                      setEditDescription(t.description ?? "");
                    }}
                    className="smallcaps text-ink-mute hover:text-accent mr-3"
                  >
                    edit
                  </button>
                  <button
                    onClick={() => setPendingDelete(t)}
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
      {editing && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="modal-card w-full max-w-lg p-6">
            <h3 className="font-semibold mb-4">Edit entry</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="smallcaps text-ink-mute block mb-1">When</span>
                <input
                  type="datetime-local"
                  value={editOccurredAt}
                  onChange={(e) => setEditOccurredAt(e.target.value)}
                  className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full num"
                />
              </label>
              <label className="block">
                <span className="smallcaps text-ink-mute block mb-1">Type</span>
                <select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value as TxType)}
                  className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full"
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </label>
              <label className="block">
                <span className="smallcaps text-ink-mute block mb-1">Category</span>
                <select
                  value={editCategoryId}
                  onChange={(e) => setEditCategoryId(e.target.value ? Number(e.target.value) : "")}
                  className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full"
                >
                  <option value="">—</option>
                  {cats?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="smallcaps text-ink-mute block mb-1">Source</span>
                <select
                  value={editSourceId}
                  onChange={(e) => setEditSourceId(e.target.value ? Number(e.target.value) : "")}
                  className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full"
                >
                  <option value="">—</option>
                  {srcs?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="smallcaps text-ink-mute block mb-1">Amount</span>
                <input
                  type="number"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full num"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="smallcaps text-ink-mute block mb-1">Description</span>
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full"
                />
              </label>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button
                onClick={() => setEditing(null)}
                className="smallcaps px-3 py-1 border border-ink/30 rounded"
                disabled={patch.isPending}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!editing || !canEdit) return;
                  patch.mutate({
                    id: editing.id,
                    body: {
                      occurred_at: new Date(editOccurredAt).toISOString(),
                      type: editType,
                      category_id: Number(editCategoryId),
                      source_id: Number(editSourceId),
                      amount: editAmount,
                      description: editDescription.trim() || null,
                    },
                  });
                }}
                disabled={!canEdit}
                className="smallcaps px-3 py-1 bg-ink text-paper rounded disabled:opacity-60"
              >
                {patch.isPending ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete this ${pendingDelete?.type ?? "entry"}?`}
        message="The entry will be soft-deleted and removed from reports."
        confirmLabel="Delete"
        busy={del.isPending}
        onClose={() => {
          if (!del.isPending) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) del.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}
