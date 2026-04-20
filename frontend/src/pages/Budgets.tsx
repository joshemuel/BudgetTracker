import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { Budget, Category, Me } from "@/types";
import { fmtMoney } from "@/lib/format";
import { SectionTitle } from "@/components/Figure";
import { useAmountVisibility } from "@/lib/privacy";

type CurrencyCode = "IDR" | "SGD" | "JPY" | "AUD" | "TWD";

function currencySymbol(c: CurrencyCode): string {
  if (c === "IDR") return "Rp";
  if (c === "SGD") return "S$";
  if (c === "JPY") return "JP¥";
  if (c === "TWD") return "NT$";
  return "A$";
}

function isSameNumeric(a: string | number, b: string | number): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return String(a) === String(b);
  return Math.abs(na - nb) < 0.000001;
}

function maskMoney(value: string, currency: CurrencyCode, showAmounts: boolean): string {
  return showAmounts ? fmtMoney(value, currency) : "••••••";
}

function maskedText(text: string, showAmounts: boolean) {
  return showAmounts ? text : <span className="masked-amount">••••••</span>;
}

function eyeButtonIcon(show: boolean) {
  if (show) {
    return (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    );
  }

  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
      <path d="M9.4 5.3A10.2 10.2 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.3 3.9" />
      <path d="M6.1 6.1C3.6 7.7 2 12 2 12s3.5 7 10 7c1.2 0 2.3-.2 3.3-.5" />
    </svg>
  );
}

export default function BudgetsPage() {
  const qc = useQueryClient();
  const { showAmounts, toggleAmounts } = useAmountVisibility();
  const { data: me } = useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/auth/me"),
  });
  const userDefault = (me?.default_currency ?? "IDR") as CurrencyCode;

  const { data: budgets } = useQuery<Budget[]>({
    queryKey: ["budgets"],
    queryFn: () => api.get<Budget[]>("/budgets"),
  });
  const { data: cats } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories"),
  });

  const [categoryId, setCategoryId] = useState<number | "">("");
  const [limit, setLimit] = useState("");
  const [editing, setEditing] = useState<Budget | null>(null);
  const [editLimit, setEditLimit] = useState("");

  const save = useMutation({
    mutationFn: () =>
      api.post("/budgets", {
        category_id: Number(categoryId),
        monthly_limit: limit,
      }),
    onSuccess: () => {
      setCategoryId("");
      setLimit("");
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  const del = useMutation({
    mutationFn: (id: number) => api.del(`/budgets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api.patch(`/budgets/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      setEditing(null);
    },
  });

  return (
    <div>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <SectionTitle kicker="The fences">Budgets</SectionTitle>
        <button
          type="button"
          onClick={toggleAmounts}
          className="smallcaps text-ink-mute hover:text-accent inline-flex items-center gap-1"
          title={showAmounts ? "Hide values" : "Show values"}
        >
          {eyeButtonIcon(showAmounts)}
          {showAmounts ? "Hide" : "Show"}
        </button>
      </div>
      <p className="text-ink-mute text-sm mb-4">
        Use the eye icon in the header to hide or reveal numeric values while sharing.
      </p>

      <div className="-mx-2 px-2 sm:mx-0 sm:px-0">
        <table className="ledger-table mb-4 w-full text-[11px] sm:text-[13px]">
          <thead>
            <tr>
              <th>Category</th>
              <th className="text-right">Monthly Limit</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(budgets ?? []).map((b) => (
              <tr key={b.id}>
                <td className="font-[450]">{b.category_name}</td>
                <td className="text-right num">
                  {maskedText(maskMoney(b.monthly_limit, b.currency, showAmounts), showAmounts)}
                </td>
                <td className="text-right whitespace-nowrap">
                  <button
                    onClick={() => {
                      setEditing(b);
                      setEditLimit(String(b.monthly_limit));
                    }}
                    className="smallcaps text-ink-mute hover:text-accent inline-block p-2 -m-2 mr-1"
                  >
                    edit
                  </button>
                  <button
                    onClick={() => del.mutate(b.id)}
                    className="smallcaps text-ink-mute hover:text-accent inline-block p-2 -m-2"
                  >
                    delete
                  </button>
                </td>
              </tr>
            ))}
            {budgets && budgets.length === 0 && (
              <tr>
                <td colSpan={3} className="text-center text-ink-mute py-8">
                  No budgets yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="modal-card w-full max-w-md p-6">
            <h3 className="font-semibold mb-4">Edit: {editing.category_name}</h3>
            <div className="space-y-3">
              <label className="block">
                <span className="smallcaps text-ink-mute block mb-1">Monthly limit</span>
                <div className="flex items-center gap-2">
                  <span className="smallcaps text-ink-mute min-w-10">{currencySymbol(userDefault)}</span>
                  <input
                    type="number"
                    value={editLimit}
                    onChange={(e) => setEditLimit(e.target.value)}
                    className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full num"
                  />
                </div>
              </label>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => {
                    if (!editing) return;
                    const body: Record<string, unknown> = {};
                    if (!isSameNumeric(editLimit, editing.monthly_limit)) {
                      body.monthly_limit = editLimit || "0";
                    }
                    if (Object.keys(body).length === 0) {
                      setEditing(null);
                      return;
                    }
                    patch.mutate({ id: editing.id, body });
                  }}
                  className="smallcaps px-3 py-1 bg-ink text-paper rounded"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="smallcaps px-3 py-1 border border-ink/30 rounded"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <form
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (categoryId && limit) save.mutate();
        }}
      >
        <label>
          <span className="smallcaps text-ink-mute block">Category</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}
            className="bg-transparent border-b border-ink py-1"
          >
            <option value="">—</option>
            {cats?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="smallcaps text-ink-mute block">Monthly limit</span>
          <div className="flex items-center gap-2">
            <span className="smallcaps text-ink-mute min-w-10">{currencySymbol(userDefault)}</span>
            <input
              type="number"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="bg-transparent border-b border-ink py-1 w-full num"
            />
          </div>
        </label>
        <button type="submit" className="smallcaps px-3 py-1 bg-ink text-paper w-full sm:w-auto">
          Save
        </button>
      </form>
    </div>
  );
}
