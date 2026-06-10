import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { Category, Me, Source, Transaction, TransactionList, TxType } from "@/types";
import {
  fmtCompactMoney,
  fmtDateTime,
  fmtMoney,
  formatAmountLive,
  handleAmountChange,
  parseAmountInput,
  toNumber,
} from "@/lib/format";
import { SectionTitle } from "@/components/Figure";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useAmountVisibility } from "@/lib/privacy";
import { useIsMobile } from "@/lib/mediaQuery";
import { TX_DELETED_EVENT, TX_EDITED_EVENT } from "@/lib/tutorial";

type CurrencyCode = "IDR" | "SGD" | "JPY" | "AUD" | "TWD" | "USD";
const CURRENCIES: CurrencyCode[] = ["IDR", "SGD", "JPY", "AUD", "TWD", "USD"];

function toLocalDateTimeInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function TransactionsPage() {
  const qc = useQueryClient();
  const { showAmounts } = useAmountVisibility();
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [sourceId, setSourceId] = useState<number | "">("");
  const [limit, setLimit] = useState(100);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [editOccurredAt, setEditOccurredAt] = useState("");
  const [editType, setEditType] = useState<TxType>("expense");
  const [editCategoryId, setEditCategoryId] = useState<number | "">("");
  const [editSourceId, setEditSourceId] = useState<number | "">("");
  const [editCurrency, setEditCurrency] = useState<CurrencyCode>("IDR");
  const [editAmount, setEditAmount] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const isMobile = useIsMobile();
  const tableScrollRef = useRef<HTMLDivElement>(null);

  const { data: cats } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories"),
  });
  const { data: srcs } = useQuery<Source[]>({
    queryKey: ["sources"],
    queryFn: () => api.get<Source[]>("/sources"),
  });
  const { data: me } = useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/auth/me"),
  });
  const sourcesEnabled = me?.sources_enabled !== false;

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", String(limit));
    p.set("offset", String((page - 1) * limit));
    if (categoryId) p.set("category_id", String(categoryId));
    if (sourcesEnabled && sourceId) p.set("source_id", String(sourceId));
    if (q) p.set("q", q);
    return p.toString();
  }, [q, categoryId, sourceId, sourcesEnabled, limit, page]);

  const { data } = useQuery<TransactionList>({
    queryKey: ["transactions", qs],
    queryFn: () => api.get<TransactionList>(`/transactions?${qs}`),
    placeholderData: keepPreviousData,
  });
  const txs = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data ? Math.max(1, Math.ceil(total / limit)) : Math.max(1, page);
  const canPrev = page > 1;
  const canNext = page < totalPages;

  useEffect(() => {
    if (!data) return;
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [data, page, totalPages]);

  const del = useMutation({
    mutationFn: (id: number) => api.del(`/transactions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["sources"] });
      qc.invalidateQueries({ queryKey: ["currencies"] });
      setPendingDelete(null);
      // Leo's tour listens for this to advance its delete exercise.
      window.dispatchEvent(new CustomEvent(TX_DELETED_EVENT));
    },
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api.patch(`/transactions/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["sources"] });
      qc.invalidateQueries({ queryKey: ["currencies"] });
      qc.invalidateQueries({ queryKey: ["monthly"] });
      qc.invalidateQueries({ queryKey: ["daily"] });
      qc.invalidateQueries({ queryKey: ["category-stats"] });
      setEditing(null);
      // Leo's tour listens for this to advance its edit exercise.
      window.dispatchEvent(new CustomEvent(TX_EDITED_EVENT));
    },
  });

  const startEdit = (t: Transaction) => {
    setEditing(t);
    setEditOccurredAt(toLocalDateTimeInput(t.occurred_at));
    setEditType(t.type);
    setEditCategoryId(t.category_id);
    setEditSourceId(t.source_id);
    setEditCurrency(t.currency);
    setEditAmount(formatAmountLive(String(toNumber(t.amount)), t.currency));
    setEditDescription(t.description ?? "");
  };

  const canEdit =
    !!editing &&
    editOccurredAt &&
    editAmount !== "" &&
    editCategoryId !== "" &&
    (sourcesEnabled ? editSourceId !== "" : true) &&
    !patch.isPending;

  return (
    <div>
      <SectionTitle>Transactions</SectionTitle>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6 border-b border-paper-rule pb-4">
        <label className="block">
          <span className="smallcaps text-ink-mute">Search</span>
          <input
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="description…"
            className="mt-1 w-full bg-transparent border-b border-ink py-1"
          />
        </label>
        <label className="block">
          <span className="smallcaps text-ink-mute">Category</span>
          <select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value ? Number(e.target.value) : "");
              setPage(1);
            }}
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
        <label className={`block ${sourcesEnabled ? "" : "opacity-45"}`}>
          <span className="smallcaps text-ink-mute">Source</span>
          <select
            value={sourceId}
            disabled={!sourcesEnabled}
            onChange={(e) => {
              setSourceId(e.target.value ? Number(e.target.value) : "");
              setPage(1);
            }}
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
            onChange={(e) => {
              setLimit(Number(e.target.value));
              setPage(1);
            }}
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

      {isMobile ? (
        <ul className="border-t border-paper-rule divide-y divide-paper-rule">
          {txs.map((t, i) => {
            const expanded = expandedId === t.id;
            return (
              <li key={t.id} data-tutorial={i === 0 ? "tx-row" : undefined}>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : t.id)}
                  aria-expanded={expanded}
                  className="w-full text-left flex items-start gap-3 py-3 min-h-[44px]"
                >
                  <span className="flex-1 min-w-0">
                    <span className="num text-ink-soft text-[11px] block">
                      {fmtDateTime(t.occurred_at)}
                    </span>
                    <span className="font-[450] block truncate">
                      {t.description || <span className="text-ink-mute italic">—</span>}
                    </span>
                    <span className="smallcaps text-ink-mute block mt-0.5">{t.category_name}</span>
                  </span>
                  <span className="shrink-0 flex flex-col items-end">
                    <span
                      className={`num ${t.type === "expense" ? "text-accent" : "text-gain"}`}
                    >
                      {showAmounts ? (
                        <>
                          {t.type === "expense" ? "−" : "+"}
                          {fmtCompactMoney(toNumber(t.amount), t.currency)}
                        </>
                      ) : (
                        "••••••"
                      )}
                    </span>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className={`text-ink-mute mt-1 transition-transform ${
                        expanded ? "rotate-180" : ""
                      }`}
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </span>
                </button>
                {expanded && (
                  <div className="pb-3">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px] border-t border-paper-rule pt-2">
                      <dt className="smallcaps text-ink-mute self-center">Source</dt>
                      <dd className="text-right">
                        {sourcesEnabled ? (showAmounts ? t.source_name : "••••••") : "N/A"}
                      </dd>
                      <dt className="smallcaps text-ink-mute self-center">Currency</dt>
                      <dd className="text-right num">{t.currency}</dd>
                      <dt className="smallcaps text-ink-mute self-center">Amount</dt>
                      <dd className="text-right num">
                        {showAmounts ? fmtMoney(toNumber(t.amount), t.currency) : "••••••"}
                      </dd>
                      {t.fx_rate && (
                        <>
                          <dt className="smallcaps text-ink-mute self-center">FX rate</dt>
                          <dd className="text-right num">{Number(t.fx_rate).toPrecision(4)}</dd>
                        </>
                      )}
                      {t.transfer_group_id && (
                        <>
                          <dt className="smallcaps text-ink-mute self-center">Kind</dt>
                          <dd className="text-right">transfer</dd>
                        </>
                      )}
                    </dl>
                    <div className="flex gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => startEdit(t)}
                        className="smallcaps flex-1 min-h-[44px] border border-ink/30 rounded-sm"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(t)}
                        className="smallcaps flex-1 min-h-[44px] border border-accent/40 text-accent rounded-sm"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
          {txs.length === 0 && (
            <li className="py-8 text-center text-ink-mute">Nothing to report.</li>
          )}
        </ul>
      ) : (
        <div
          ref={tableScrollRef}
          className="tx-scroll overflow-y-auto"
          style={{ maxHeight: "calc(100vh - 30rem)" }}
        >
          <table className="ledger-table w-full text-[13px]">
            <thead>
              <tr>
                <th>When</th>
                <th>Description</th>
                <th>Category</th>
                <th>Source</th>
                <th>Currency</th>
                <th className="text-right">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {txs.map((t, i) => (
                <tr key={t.id} data-tutorial={i === 0 ? "tx-row" : undefined}>
                  <td className="num text-ink-soft text-sm">{fmtDateTime(t.occurred_at)}</td>
                  <td className="font-[450]">
                    {t.description || <span className="text-ink-mute italic">—</span>}
                    {t.transfer_group_id && (
                      <span className="ml-2 smallcaps text-ink-mute">transfer</span>
                    )}
                    {t.fx_rate && (
                      <span className="ml-2 smallcaps text-ink-mute whitespace-nowrap">
                        fx {Number(t.fx_rate).toPrecision(4)}
                      </span>
                    )}
                  </td>
                  <td>{t.category_name}</td>
                  <td className="text-ink-soft">
                    {sourcesEnabled ? (
                      showAmounts ? t.source_name : <span className="masked-amount">••••••</span>
                    ) : (
                      "N/A"
                    )}
                  </td>
                  <td className="text-ink-soft">{t.currency}</td>
                  <td
                    className={`text-right num ${
                      t.type === "expense" ? "text-accent" : "text-gain"
                    }`}
                  >
                    {showAmounts ? (
                      <>
                        {t.type === "expense" ? "−" : "+"}
                        {fmtMoney(toNumber(t.amount), t.currency)}
                      </>
                    ) : (
                      "••••••"
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button
                      onClick={() => startEdit(t)}
                      className="smallcaps text-ink-mute hover:text-accent inline-block p-2 -m-2 mr-1"
                    >
                      edit
                    </button>
                    <button
                      onClick={() => setPendingDelete(t)}
                      className="smallcaps text-ink-mute hover:text-accent inline-block p-2 -m-2"
                    >
                      delete
                    </button>
                  </td>
                </tr>
              ))}
              {txs.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-ink-mute py-8">
                    Nothing to report.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="smallcaps text-ink-mute">
            Page {page} of {totalPages} · {total} total
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                if (canPrev) {
                  setPage((p) => p - 1);
                  if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
                  else window.scrollTo({ top: 0, behavior: "instant" });
                }
              }}
              disabled={!canPrev}
              className="smallcaps px-3 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                if (canNext) {
                  setPage((p) => p + 1);
                  if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
                  else window.scrollTo({ top: 0, behavior: "instant" });
                }
              }}
              disabled={!canNext}
              className="smallcaps px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
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
              {sourcesEnabled ? (
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
              ) : (
                <label className="block">
                  <span className="smallcaps text-ink-mute block mb-1">Currency</span>
                  <select
                    value={editCurrency}
                    onChange={(e) => setEditCurrency(e.target.value as CurrencyCode)}
                    className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full"
                  >
                    {CURRENCIES.map((currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block sm:col-span-2">
                <span className="smallcaps text-ink-mute block mb-1">Amount</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={editAmount}
                  onChange={(e) => handleAmountChange(e.currentTarget, editCurrency, setEditAmount)}
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
                      ...(sourcesEnabled
                        ? { source_id: Number(editSourceId) }
                        : { currency: editCurrency }),
                      amount: parseAmountInput(editAmount),
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
