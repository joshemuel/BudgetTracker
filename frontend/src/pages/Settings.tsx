import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { Category, Source } from "@/types";
import { fmtMoney } from "@/lib/format";
import { useAmountVisibility } from "@/lib/privacy";
import { SectionTitle } from "@/components/Figure";
import ConfirmDialog from "@/components/ConfirmDialog";

const CURRENCIES = ["IDR", "SGD", "JPY", "AUD", "TWD"] as const;
type CurrencyCode = (typeof CURRENCIES)[number];

function currencySymbol(c: CurrencyCode): string {
  if (c === "IDR") return "Rp";
  if (c === "SGD") return "S$";
  if (c === "JPY") return "JP¥";
  if (c === "TWD") return "NT$";
  return "A$";
}

function displayAmount(v: string, c: CurrencyCode): string {
  return fmtMoney(v, c).replace(`${currencySymbol(c)} `, "");
}

function parseDisplayAmount(raw: string): string {
  const cleaned = raw.replace(/,/g, "").replace(/[^0-9.-]/g, "");
  const neg = cleaned.startsWith("-");
  const unsigned = cleaned.replace(/-/g, "");
  const parts = unsigned.split(".");
  const intPart = parts[0] || "0";
  const fracPart = parts.slice(1).join("");
  return `${neg ? "-" : ""}${intPart}${fracPart ? `.${fracPart}` : ""}`;
}

function normalizeInput(raw: string, currency: CurrencyCode): string {
  let parsed = parseDisplayAmount(raw);
  if (currency === "JPY") {
    parsed = String(Math.round(Number(parsed || "0")));
  }
  return displayAmount(parsed, currency);
}

function isSameNumeric(a: string | number, b: string | number): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return String(a) === String(b);
  return Math.abs(na - nb) < 0.000001;
}

function SourcesBlock() {
  const qc = useQueryClient();
  const { showAmounts } = useAmountVisibility();
  const { data } = useQuery<Source[]>({
    queryKey: ["sources"],
    queryFn: () => api.get<Source[]>("/sources"),
  });
  const [name, setName] = useState("");
  const [isCc, setIsCc] = useState(false);
  const [currentFundsInput, setCurrentFundsInput] = useState("0");
  const [currency, setCurrency] = useState<CurrencyCode>("IDR");
  const [editing, setEditing] = useState<Source | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Source | null>(null);
  const [editName, setEditName] = useState("");
  const [editCurrentFundsInput, setEditCurrentFundsInput] = useState("0");
  const [editCurrency, setEditCurrency] = useState<CurrencyCode>("IDR");

  const create = useMutation({
    mutationFn: () =>
      api.post("/sources", {
        name,
        is_credit_card: isCc,
        current_balance: parseDisplayAmount(currentFundsInput),
        currency,
      }),
    onSuccess: () => {
      setName("");
      setCurrentFundsInput("0");
      setCurrency("IDR");
      setIsCc(false);
      qc.invalidateQueries({ queryKey: ["sources"] });
    },
  });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/sources/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sources"] });
      setPendingDelete(null);
    },
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api.patch(`/sources/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sources"] });
      setEditing(null);
    },
  });

  return (
    <section>
      <SectionTitle kicker="The wallets">Sources</SectionTitle>
      <div className="-mx-2 px-2 sm:mx-0 sm:px-0">
        <table className="ledger-table mb-4 w-full text-[11px] sm:text-[13px]">
          <thead>
            <tr>
              <th>Name</th>
              <th className="text-right">Current Funds</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.map((s) => (
              <tr key={s.id}>
                <td className="font-[450]">
                  {s.name}
                  {s.is_credit_card && (
                    <span className="ml-2 smallcaps text-accent">credit</span>
                  )}
                </td>
                <td className={`text-right num ${s.is_credit_card ? "text-accent" : ""}`}>
                  {showAmounts ? fmtMoney(s.current_balance, s.currency) : "••••••"}
                </td>
                <td className="text-right">
                  <button
                    onClick={() => {
                      setEditing(s);
                      setEditName(s.name);
                      setEditCurrentFundsInput(normalizeInput(String(s.current_balance), s.currency));
                      setEditCurrency(s.currency);
                    }}
                    className="smallcaps text-ink-mute hover:text-accent inline-block p-2 -m-2 mr-1"
                  >
                    edit
                  </button>
                  <button
                    onClick={() => setPendingDelete(s)}
                    className="smallcaps text-ink-mute hover:text-accent inline-block p-2 -m-2"
                  >
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="modal-card w-full max-w-md p-6">
            <h3 className="font-semibold mb-4">Edit: {editing.name}</h3>
            <div className="space-y-3">
              <label className="block">
                <span className="smallcaps text-ink-mute block mb-1">Rename</span>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full"
                />
              </label>
              <label className="block">
                <span className="smallcaps text-ink-mute block mb-1">Reset current funds</span>
                <div className="flex items-center gap-2">
                  <span className="smallcaps text-ink-mute min-w-10">{currencySymbol(editCurrency)}</span>
                  <input
                    value={editCurrentFundsInput}
                    onChange={(e) => setEditCurrentFundsInput(e.target.value)}
                    onBlur={() => setEditCurrentFundsInput(normalizeInput(editCurrentFundsInput, editCurrency))}
                    onFocus={() =>
                      setEditCurrentFundsInput(parseDisplayAmount(editCurrentFundsInput))
                    }
                    className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full num"
                  />
                </div>
              </label>
              <label className="block">
                <span className="smallcaps text-ink-mute block mb-1">Currency</span>
                <select
                  value={editCurrency}
                  onChange={(e) => {
                    const next = e.target.value as CurrencyCode;
                    setEditCurrency(next);
                    setEditCurrentFundsInput(normalizeInput(editCurrentFundsInput, next));
                  }}
                  className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => {
                    if (!editing) return;
                    const body: Record<string, unknown> = {};
                    const trimmedName = editName.trim();
                    if (trimmedName && trimmedName !== editing.name) {
                      body.name = trimmedName;
                    }
                    const parsedEditCurrent = parseDisplayAmount(editCurrentFundsInput);
                    if (!isSameNumeric(parsedEditCurrent, editing.current_balance)) {
                      body.current_balance = parsedEditCurrent || "0";
                    }
                    if (editCurrency !== editing.currency) {
                      body.currency = editCurrency;
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
      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.name ?? "this source"}?`}
        message="If this source has transaction history, it will be deactivated and hidden from active lists."
        confirmLabel="Delete"
        busy={del.isPending}
        onClose={() => {
          if (!del.isPending) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) del.mutate(pendingDelete.id);
        }}
      />
      <form
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <label>
          <span className="smallcaps text-ink-mute block">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-transparent border-b border-ink py-1"
          />
        </label>
        <label>
          <span className="smallcaps text-ink-mute block">Current funds</span>
          <div className="flex items-center gap-2">
            <span className="smallcaps text-ink-mute min-w-10">{currencySymbol(currency)}</span>
            <input
              value={currentFundsInput}
              onChange={(e) => setCurrentFundsInput(e.target.value)}
              onBlur={() => setCurrentFundsInput(normalizeInput(currentFundsInput, currency))}
              onFocus={() => setCurrentFundsInput(parseDisplayAmount(currentFundsInput))}
              className="bg-transparent border-b border-ink py-1 w-40 num"
            />
          </div>
        </label>
        <label>
          <span className="smallcaps text-ink-mute block">Currency</span>
          <select
            value={currency}
            onChange={(e) => {
              const next = e.target.value as CurrencyCode;
              setCurrency(next);
              setCurrentFundsInput(normalizeInput(currentFundsInput, next));
            }}
            className="bg-transparent border-b border-ink py-1"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 py-1">
          <input type="checkbox" checked={isCc} onChange={(e) => setIsCc(e.target.checked)} />
          <span className="smallcaps text-ink-mute">Credit card</span>
        </label>
        <button type="submit" className="smallcaps px-3 py-1 bg-ink text-paper w-full sm:w-auto">
          Add source
        </button>
      </form>
    </section>
  );
}

function CategoriesBlock() {
  const qc = useQueryClient();
  const { data } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories"),
  });
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<Category | null>(null);
  const [editName, setEditName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.post("/categories", { name }),
    onSuccess: () => {
      setName("");
      setError(null);
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["category-stats"] });
    },
    onError: (e: Error) => setError(e.message || "Could not add category"),
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api.patch(`/categories/${id}`, body),
    onSuccess: () => {
      setError(null);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["category-stats"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
    },
    onError: (e: Error) => setError(e.message || "Could not rename category"),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/categories/${id}`),
    onSuccess: () => {
      setError(null);
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["category-stats"] });
    },
    onError: (e: Error) => {
      setPendingDelete(null);
      setError(e.message || "Could not delete category");
    },
  });

  return (
    <section className="mt-12">
      <SectionTitle kicker="The taxonomy">Categories</SectionTitle>
      <div className="-mx-2 px-2 sm:mx-0 sm:px-0 mb-6">
        <table className="ledger-table w-full text-[11px] sm:text-[13px]">
          <thead>
            <tr>
              <th>Category</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.map((c) => (
              <tr key={c.id}>
                <td className="font-[450]">{c.name}</td>
                <td className="text-right whitespace-nowrap">
                  <button
                    onClick={() => {
                      setEditing(c);
                      setEditName(c.name);
                    }}
                    className="smallcaps text-ink-mute hover:text-accent inline-block p-2 -m-2 mr-1"
                  >
                    edit
                  </button>
                  <button
                    onClick={() => setPendingDelete(c)}
                    className="smallcaps text-ink-mute hover:text-accent inline-block p-2 -m-2"
                  >
                    delete
                  </button>
                </td>
              </tr>
            ))}
            {data && data.length === 0 && (
              <tr>
                <td colSpan={2} className="text-center text-ink-mute py-8">
                  No categories yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {error && <p className="text-sm text-accent italic mb-4">{error}</p>}
      {editing && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="modal-card w-full max-w-md p-6">
            <h3 className="font-semibold mb-4">Edit: {editing.name}</h3>
            <label className="block">
              <span className="smallcaps text-ink-mute block mb-1">Rename</span>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full"
                autoFocus
              />
            </label>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  if (!editing) return;
                  const trimmed = editName.trim();
                  if (!trimmed || trimmed === editing.name) {
                    setEditing(null);
                    return;
                  }
                  patch.mutate({ id: editing.id, body: { name: trimmed } });
                }}
                disabled={patch.isPending}
                className="smallcaps px-3 py-1 bg-ink text-paper rounded disabled:opacity-60"
              >
                {patch.isPending ? "Saving..." : "Save"}
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
      )}
      <form
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <label>
          <span className="smallcaps text-ink-mute block">Custom category</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-transparent border-b border-ink py-1"
          />
        </label>
        <button type="submit" className="smallcaps px-3 py-1 bg-ink text-paper w-full sm:w-auto">
          Add
        </button>
      </form>
      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.name ?? "this category"}?`}
        message="If this category still has transactions, deletion will be blocked."
        confirmLabel="Delete"
        busy={del.isPending}
        onClose={() => {
          if (!del.isPending) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) del.mutate(pendingDelete.id);
        }}
      />
    </section>
  );
}

export default function SettingsPage() {
  return (
    <div className="max-w-3xl">
      <SourcesBlock />
      <CategoriesBlock />
    </div>
  );
}
