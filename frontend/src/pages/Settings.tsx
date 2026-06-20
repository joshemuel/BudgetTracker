import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { AdminUser, Category, CurrencyBalance, Me, SheetsStatus, Source } from "@/types";
import { fmtMoney, formatAmountLive, handleAmountChange } from "@/lib/format";
import { useAmountVisibility } from "@/lib/privacy";
import { SectionTitle } from "@/components/Figure";
import ConfirmDialog from "@/components/ConfirmDialog";
import TrackAsOtherDialog from "@/components/TrackAsOtherDialog";
import PreferencesForm from "@/components/PreferencesForm";

const CURRENCIES = ["IDR", "SGD", "JPY", "AUD", "TWD", "USD"] as const;
type CurrencyCode = (typeof CURRENCIES)[number];

function currencySymbol(c: CurrencyCode): string {
  if (c === "IDR") return "Rp";
  if (c === "SGD") return "S$";
  if (c === "JPY") return "JP¥";
  if (c === "TWD") return "NT$";
  if (c === "USD") return "US$";
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

function CurrencyBlock({ sourcesEnabled }: { sourcesEnabled: boolean }) {
  const qc = useQueryClient();
  const { showAmounts } = useAmountVisibility();
  const { data: currencies } = useQuery<CurrencyBalance[]>({
    queryKey: ["currencies"],
    queryFn: () => api.get<CurrencyBalance[]>("/currencies"),
  });
  const { data: sources } = useQuery<Source[]>({
    queryKey: ["sources"],
    queryFn: () => api.get<Source[]>("/sources"),
  });
  const [editing, setEditing] = useState<CurrencyBalance | null>(null);
  const [currentFundsInput, setCurrentFundsInput] = useState("0");
  const [confirmTrack, setConfirmTrack] = useState<{
    currency: CurrencyCode;
    body: Record<string, unknown>;
  } | null>(null);

  const patch = useMutation({
    mutationFn: ({ currency, body }: { currency: CurrencyCode; body: Record<string, unknown> }) =>
      api.patch(`/currencies/${currency}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["currencies"] });
      qc.invalidateQueries({ queryKey: ["sources"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      setEditing(null);
      setConfirmTrack(null);
    },
  });

  return (
    <section className="mb-12" data-tutorial="currencies-table">
      <SectionTitle>Currencies</SectionTitle>
      <div className="card overflow-hidden">
        <table className="ledger-table w-full text-[11px] sm:text-[13px]">
          <thead>
            <tr>
              <th>Currency</th>
              <th className="text-right">Current Funds</th>
              <th>Default Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(currencies ?? []).map((c) => (
              <tr key={c.currency}>
                <td className="font-[550]">{c.currency}</td>
                <td className="text-right num">
                  {showAmounts ? fmtMoney(c.current_balance, c.currency) : "••••••"}
                </td>
                <td>
                  <select
                    value={c.default_source_id ?? ""}
                    disabled={!sourcesEnabled || patch.isPending}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      patch.mutate({
                        currency: c.currency,
                        body: { default_source_id: Number(e.target.value) },
                      });
                    }}
                    className="w-full rounded-xl border border-paper-rule bg-surface px-3 py-2 disabled:opacity-45 focus-visible:outline-none"
                  >
                    {(sources ?? [])
                      .filter((s) => s.active && s.currency === c.currency)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(c);
                      setCurrentFundsInput(normalizeInput(c.current_balance, c.currency));
                    }}
                    className="smallcaps text-ink-mute hover:text-ink inline-block p-2 -m-2 transition-colors duration-150"
                  >
                    reset
                  </button>
                </td>
              </tr>
            ))}
            {currencies && currencies.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-ink-mute py-8">
                  Add a source to establish a currency.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="modal-card w-full max-w-md p-6">
            <h3 className="font-semibold mb-4">Reset: {editing.currency}</h3>
            <label className="block">
              <span className="smallcaps text-ink-mute block mb-1">Current funds</span>
              <div className="flex items-center gap-2">
                <span className="smallcaps text-ink-mute min-w-10">
                  {currencySymbol(editing.currency)}
                </span>
                <input
                  value={currentFundsInput}
                  onChange={(e) =>
                    handleAmountChange(e.currentTarget, editing.currency, setCurrentFundsInput)
                  }
                  onBlur={() =>
                    setCurrentFundsInput(normalizeInput(currentFundsInput, editing.currency))
                  }
                  onFocus={() =>
                    setCurrentFundsInput(formatAmountLive(currentFundsInput, editing.currency))
                  }
                  className="rounded-xl border border-paper-rule bg-surface px-3 py-2 w-full num focus-visible:outline-none"
                />
              </div>
            </label>
            <div className="flex gap-2 mt-5 justify-end">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="smallcaps rounded-full border border-paper-rule bg-surface px-4 py-2 text-ink-soft hover:bg-paper-deep hover:text-ink transition-all duration-150 active:scale-95 disabled:opacity-60"
                disabled={patch.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  setConfirmTrack({
                    currency: editing.currency,
                    body: { current_balance: parseDisplayAmount(currentFundsInput) || "0" },
                  })
                }
                className="smallcaps rounded-full px-4 py-2 text-white shadow-sm hover:brightness-110 transition-all duration-150 active:scale-95 disabled:opacity-60"
                style={{ backgroundColor: "var(--section-edge)" }}
                disabled={patch.isPending}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      <TrackAsOtherDialog
        open={confirmTrack !== null}
        busy={patch.isPending}
        onTrack={() => {
          if (confirmTrack)
            patch.mutate({
              currency: confirmTrack.currency,
              body: { ...confirmTrack.body, track_as_other: true },
            });
        }}
        onKeepUntracked={() => {
          if (confirmTrack)
            patch.mutate({ currency: confirmTrack.currency, body: confirmTrack.body });
        }}
        onCancel={() => {
          if (!patch.isPending) setConfirmTrack(null);
        }}
      />
    </section>
  );
}

function SourcesBlock({ enabled }: { enabled: boolean }) {
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
  const [editIsCc, setEditIsCc] = useState(false);
  const [confirmTrack, setConfirmTrack] = useState<{
    id: number;
    body: Record<string, unknown>;
  } | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post("/sources", {
        name,
        is_credit_card: isCc || /credit\s*card/i.test(name),
        current_balance: parseDisplayAmount(currentFundsInput),
        currency,
      }),
    onSuccess: () => {
      setName("");
      setCurrentFundsInput("0");
      setCurrency("IDR");
      setIsCc(false);
      qc.invalidateQueries({ queryKey: ["sources"] });
      qc.invalidateQueries({ queryKey: ["currencies"] });
    },
  });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/sources/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sources"] });
      qc.invalidateQueries({ queryKey: ["currencies"] });
      setPendingDelete(null);
    },
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api.patch(`/sources/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sources"] });
      qc.invalidateQueries({ queryKey: ["currencies"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      setEditing(null);
      setConfirmTrack(null);
    },
  });

  return (
    <section className={enabled ? "" : "opacity-45 grayscale"}>
      <fieldset disabled={!enabled}>
      <SectionTitle>Sources</SectionTitle>
      <div className="card mb-4 overflow-hidden">
        <table className="ledger-table w-full text-[11px] sm:text-[13px]">
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
                <td className="font-[550]">
                  {s.name}
                  {s.is_credit_card && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 smallcaps text-accent">credit</span>
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
                      setEditIsCc(s.is_credit_card);
                    }}
                    className="smallcaps text-ink-mute hover:text-ink inline-block p-2 -m-2 mr-1 transition-colors duration-150"
                  >
                    edit
                  </button>
                  <button
                    onClick={() => setPendingDelete(s)}
                    className="smallcaps text-ink-mute hover:text-accent inline-block p-2 -m-2 transition-colors duration-150"
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
                  className="rounded-xl border border-paper-rule bg-surface px-3 py-2 w-full focus-visible:outline-none"
                />
              </label>
              <label className="block">
                <span className="smallcaps text-ink-mute block mb-1">Reset current funds</span>
                <div className="flex items-center gap-2">
                  <span className="smallcaps text-ink-mute min-w-10">{currencySymbol(editCurrency)}</span>
                  <input
                    value={editCurrentFundsInput}
                    onChange={(e) =>
                      handleAmountChange(e.currentTarget, editCurrency, setEditCurrentFundsInput)
                    }
                    onBlur={() => setEditCurrentFundsInput(normalizeInput(editCurrentFundsInput, editCurrency))}
                    onFocus={() =>
                      setEditCurrentFundsInput(formatAmountLive(editCurrentFundsInput, editCurrency))
                    }
                    className="rounded-xl border border-paper-rule bg-surface px-3 py-2 w-full num focus-visible:outline-none"
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
                  className="rounded-xl border border-paper-rule bg-surface px-3 py-2 w-full focus-visible:outline-none"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editIsCc}
                  onChange={(e) => setEditIsCc(e.target.checked)}
                />
                <span className="smallcaps text-ink-mute">Credit card</span>
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
                    const balanceChanged = !isSameNumeric(
                      parsedEditCurrent,
                      editing.current_balance,
                    );
                    if (balanceChanged) {
                      body.current_balance = parsedEditCurrent || "0";
                    }
                    if (editCurrency !== editing.currency) {
                      body.currency = editCurrency;
                    }
                    if (editIsCc !== editing.is_credit_card) {
                      body.is_credit_card = editIsCc;
                    }
                    if (Object.keys(body).length === 0) {
                      setEditing(null);
                      return;
                    }
                    // A direct balance change creates a reconciliation delta — ask
                    // whether to record it as "Others" or keep it untracked.
                    if (balanceChanged) {
                      setConfirmTrack({ id: editing.id, body });
                    } else {
                      patch.mutate({ id: editing.id, body });
                    }
                  }}
                  className="smallcaps rounded-full px-4 py-2 text-white shadow-sm hover:brightness-110 transition-all duration-150 active:scale-95"
                  style={{ backgroundColor: "var(--section-edge)" }}
                >
                  Save
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="smallcaps rounded-full border border-paper-rule bg-surface px-4 py-2 text-ink-soft hover:bg-paper-deep hover:text-ink transition-all duration-150 active:scale-95"
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
      <TrackAsOtherDialog
        open={confirmTrack !== null}
        busy={patch.isPending}
        onTrack={() => {
          if (confirmTrack)
            patch.mutate({
              id: confirmTrack.id,
              body: { ...confirmTrack.body, track_as_other: true },
            });
        }}
        onKeepUntracked={() => {
          if (confirmTrack) patch.mutate({ id: confirmTrack.id, body: confirmTrack.body });
        }}
        onCancel={() => {
          if (!patch.isPending) setConfirmTrack(null);
        }}
      />
      <form
        className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end p-4 sm:p-5"
        data-tutorial="add-source-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <label>
          <span className="smallcaps text-ink-mute block mb-1">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-paper-rule bg-surface px-3 py-2 focus-visible:outline-none"
          />
        </label>
        <label>
          <span className="smallcaps text-ink-mute block mb-1">Current funds</span>
          <div className="flex items-center gap-2">
            <span className="smallcaps text-ink-mute min-w-10">{currencySymbol(currency)}</span>
            <input
              value={currentFundsInput}
              onChange={(e) => handleAmountChange(e.currentTarget, currency, setCurrentFundsInput)}
              onBlur={() => setCurrentFundsInput(normalizeInput(currentFundsInput, currency))}
              onFocus={() => setCurrentFundsInput(formatAmountLive(currentFundsInput, currency))}
              className="rounded-xl border border-paper-rule bg-surface px-3 py-2 w-full sm:w-40 num focus-visible:outline-none"
            />
          </div>
        </label>
        <label>
          <span className="smallcaps text-ink-mute block mb-1">Currency</span>
          <select
            value={currency}
            onChange={(e) => {
              const next = e.target.value as CurrencyCode;
              setCurrency(next);
              setCurrentFundsInput(normalizeInput(currentFundsInput, next));
            }}
            className="w-full rounded-xl border border-paper-rule bg-surface px-3 py-2 focus-visible:outline-none"
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
        <button
          type="submit"
          className="smallcaps rounded-full px-4 py-2 text-white shadow-sm hover:brightness-110 transition-all duration-150 active:scale-95 w-full sm:w-auto"
          style={{ backgroundColor: "var(--section-edge)" }}
        >
          Add source
        </button>
      </form>
      </fieldset>
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
      <SectionTitle>Categories</SectionTitle>
      <div className="card mb-6 overflow-hidden">
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
                <td className="font-[550]">{c.name}</td>
                <td className="text-right whitespace-nowrap">
                  <button
                    onClick={() => {
                      setEditing(c);
                      setEditName(c.name);
                    }}
                    className="smallcaps text-ink-mute hover:text-ink inline-block p-2 -m-2 mr-1 transition-colors duration-150"
                  >
                    edit
                  </button>
                  <button
                    onClick={() => setPendingDelete(c)}
                    className="smallcaps text-ink-mute hover:text-accent inline-block p-2 -m-2 transition-colors duration-150"
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
                className="rounded-xl border border-paper-rule bg-surface px-3 py-2 w-full focus-visible:outline-none"
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
                className="smallcaps rounded-full px-4 py-2 text-white shadow-sm hover:brightness-110 transition-all duration-150 active:scale-95 disabled:opacity-60"
                style={{ backgroundColor: "var(--section-edge)" }}
              >
                {patch.isPending ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setEditing(null)}
                className="smallcaps rounded-full border border-paper-rule bg-surface px-4 py-2 text-ink-soft hover:bg-paper-deep hover:text-ink transition-all duration-150 active:scale-95"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <form
        className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <label>
          <span className="smallcaps text-ink-mute block mb-1">Custom category</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-paper-rule bg-surface px-3 py-2 focus-visible:outline-none"
          />
        </label>
        <button
          type="submit"
          className="smallcaps rounded-full px-4 py-2 text-white shadow-sm hover:brightness-110 transition-all duration-150 active:scale-95 w-full sm:w-auto"
          style={{ backgroundColor: "var(--section-edge)" }}
        >
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

function statusTone(status: AdminUser["status"]): string {
  if (status === "pending") return "bg-warn/10 text-warn";
  if (status === "rejected") return "bg-paper-deep text-ink-mute line-through";
  return "bg-gain/10 text-gain";
}

function AdminBlock() {
  const qc = useQueryClient();
  const { data: users } = useQuery<AdminUser[]>({
    queryKey: ["admin-users"],
    queryFn: () => api.get<AdminUser[]>("/admin/users"),
  });

  const approve = useMutation({
    mutationFn: (id: number) => api.post(`/admin/users/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });
  const reject = useMutation({
    mutationFn: (id: number) => api.post(`/admin/users/${id}/reject`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const pending = (users ?? []).filter((u) => u.status === "pending");

  return (
    <section className="mt-12">
      <SectionTitle>Members</SectionTitle>
      <p className="text-ink-mute text-sm mb-4">
        {pending.length > 0
          ? `${pending.length} account${pending.length > 1 ? "s" : ""} awaiting your approval.`
          : "Approve or revoke access for people who signed in with Google."}
      </p>
      <div className="card overflow-hidden">
        <table className="ledger-table w-full text-[11px] sm:text-[13px]">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.id}>
                <td className="font-[550]">
                  {u.username}
                  {u.is_admin && <span className="smallcaps text-ink-mute"> · admin</span>}
                </td>
                <td className="text-ink-soft">{u.email ?? "—"}</td>
                <td>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 smallcaps ${statusTone(u.status)}`}>
                    {u.status}
                  </span>
                </td>
                <td className="text-right whitespace-nowrap">
                  {u.status !== "approved" && (
                    <button
                      onClick={() => approve.mutate(u.id)}
                      className="smallcaps text-ink-mute hover:text-gain inline-block p-2 -m-2 mr-1 transition-colors duration-150"
                    >
                      approve
                    </button>
                  )}
                  {u.status !== "rejected" && !u.is_admin && (
                    <button
                      onClick={() => reject.mutate(u.id)}
                      className="smallcaps text-ink-mute hover:text-accent inline-block p-2 -m-2 transition-colors duration-150"
                    >
                      reject
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {users && users.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-ink-mute py-8">
                  No members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type LinkTokenOut = { deep_link: string; bot_username: string; expires_in: number };

function ConnectedAppsBlock() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const tgConnected = !!me?.telegram_chat_id;
  const [pendingLink, setPendingLink] = useState<LinkTokenOut | null>(null);
  const [copied, setCopied] = useState(false);
  const [tgConfirmOpen, setTgConfirmOpen] = useState(false);
  const pollRef = useRef<number | null>(null);

  // Google Sheets
  const { data: sheets } = useQuery<SheetsStatus>({
    queryKey: ["sheets-status"],
    queryFn: () => api.get<SheetsStatus>("/sheets/status"),
  });
  const sheetsConnected = !!sheets?.connected;
  const [gsConfirmOpen, setGsConfirmOpen] = useState(false);
  const [justConnected, setJustConnected] = useState(false);

  const issueLink = useMutation({
    mutationFn: () => api.post<LinkTokenOut>("/telegram/link_token"),
    onSuccess: (r) => {
      setPendingLink(r);
      setCopied(false);
      // t.me hands off to the native Telegram app on mobile; new tab on desktop.
      window.open(r.deep_link, "_blank", "noopener");
    },
  });

  const disconnectTg = useMutation({
    mutationFn: () => api.post("/telegram/unlink"),
    onSuccess: () => {
      setTgConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const syncNow = useMutation({
    mutationFn: () => api.post<SheetsStatus>("/sheets/sync"),
    onSuccess: (r) => qc.setQueryData(["sheets-status"], r),
  });
  const toggleAuto = useMutation({
    mutationFn: (auto_sync: boolean) => api.patch<SheetsStatus>("/sheets", { auto_sync }),
    onSuccess: (r) => qc.setQueryData(["sheets-status"], r),
  });
  const disconnectSheets = useMutation({
    mutationFn: () => api.post("/sheets/disconnect"),
    onSuccess: () => {
      setGsConfirmOpen(false);
      setJustConnected(false);
      qc.invalidateQueries({ queryKey: ["sheets-status"] });
    },
  });

  // Window-focus refetch is globally off, so while a link is outstanding poll
  // ["me"] until the binding lands (the user confirms inside Telegram, not here).
  useEffect(() => {
    if (!pendingLink || tgConnected) {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
      if (tgConnected) setPendingLink(null);
      return;
    }
    const refresh = () => qc.invalidateQueries({ queryKey: ["me"] });
    pollRef.current = window.setInterval(refresh, 3000);
    window.addEventListener("focus", refresh);
    const expiry = window.setTimeout(() => setPendingLink(null), pendingLink.expires_in * 1000);
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
      window.removeEventListener("focus", refresh);
      window.clearTimeout(expiry);
    };
  }, [pendingLink, tgConnected, qc]);

  // Returning from the Google OAuth redirect lands here with ?sheets=connected.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("sheets") === "connected") {
      setJustConnected(true);
      qc.invalidateQueries({ queryKey: ["sheets-status"] });
      params.delete("sheets");
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, [qc]);

  const lastSynced = sheets?.last_synced_at
    ? new Date(sheets.last_synced_at).toLocaleString()
    : null;

  return (
    <section className="mt-12" data-tutorial="connect-telegram">
      <SectionTitle>Connected apps</SectionTitle>
      <p className="text-ink-mute text-sm mb-4">
        Link other apps to log entries, ask about your finances, or mirror your ledger — from
        anywhere.
      </p>
      <div className="card divide-y divide-paper-rule overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3.5 flex-wrap">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white"
            style={{ backgroundColor: "var(--section-edge)" }}
            aria-hidden="true"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21.9 4.6 18.6 20c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6 13.2l-4.8-1.5c-1-.3-1-1 .2-1.5L20.6 3c.9-.3 1.6.2 1.3 1.6Z" />
            </svg>
          </span>
          <span className="font-[550] flex-1 min-w-0">Telegram</span>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 smallcaps ${
              tgConnected ? "bg-gain/10 text-gain" : "bg-paper-deep text-ink-mute"
            }`}
          >
            {tgConnected ? "Connected" : "Not connected"}
          </span>
          {tgConnected ? (
            <button
              onClick={() => setTgConfirmOpen(true)}
              className="smallcaps rounded-full border border-paper-rule bg-surface px-4 py-1.5 text-ink-soft hover:bg-paper-deep hover:text-accent transition-all duration-150 active:scale-95"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => issueLink.mutate()}
              disabled={issueLink.isPending}
              className="smallcaps rounded-full px-4 py-1.5 text-white shadow-sm hover:brightness-110 transition-all duration-150 active:scale-95 disabled:opacity-50"
              style={{ backgroundColor: "var(--section-edge)" }}
            >
              {issueLink.isPending ? "Opening…" : "Connect"}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 px-4 py-3.5 flex-wrap">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white"
            style={{ backgroundColor: "var(--section-edge)" }}
            aria-hidden="true"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 1.5V8h3.5L13 4.5ZM8 12h8v1.6H8V12Zm0 3.2h8v1.6H8v-1.6Zm0-6.4h3.4v1.6H8V8.8Z" />
            </svg>
          </span>
          <span className="font-[550] flex-1 min-w-0">
            Google Sheets
            {sheetsConnected && sheets?.google_email && (
              <span className="text-ink-mute font-normal"> · {sheets.google_email}</span>
            )}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 smallcaps ${
              sheetsConnected ? "bg-gain/10 text-gain" : "bg-paper-deep text-ink-mute"
            }`}
          >
            {sheetsConnected ? "Connected" : "Not connected"}
          </span>
          {sheetsConnected ? (
            <button
              onClick={() => setGsConfirmOpen(true)}
              className="smallcaps rounded-full border border-paper-rule bg-surface px-4 py-1.5 text-ink-soft hover:bg-paper-deep hover:text-accent transition-all duration-150 active:scale-95"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => {
                window.location.href = "/api/sheets/connect";
              }}
              className="smallcaps rounded-full px-4 py-1.5 text-white shadow-sm hover:brightness-110 transition-all duration-150 active:scale-95"
              style={{ backgroundColor: "var(--section-edge)" }}
            >
              Connect
            </button>
          )}
        </div>
      </div>
      {issueLink.isError && (
        <p className="text-accent text-sm mt-3">
          {(issueLink.error as Error).message || "Couldn't reach Telegram. Try again later."}
        </p>
      )}
      {pendingLink && !tgConnected && (
        <div className="mt-3 text-sm text-ink-soft">
          <p>
            Telegram should have opened — tap <span className="font-[550]">Start</span> in the bot
            chat to finish connecting. Didn't open?{" "}
            <a
              href={pendingLink.deep_link}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-accent break-all"
            >
              Open this link
            </a>{" "}
            <button
              onClick={() => {
                navigator.clipboard?.writeText(pendingLink.deep_link).then(() => setCopied(true));
              }}
              className="smallcaps text-ink-mute hover:text-ink"
            >
              {copied ? "copied" : "copy"}
            </button>
          </p>
          <p className="text-ink-mute mt-1">The link expires in 10 minutes.</p>
        </div>
      )}
      {sheetsConnected && (
        <div className="card mt-4 p-4 text-sm text-ink-soft space-y-3">
          {justConnected && (
            <p className="text-gain">Connected — your spreadsheet has been created and filled.</p>
          )}
          <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
            <span>Google Sheets: automatic sync (hourly)</span>
            <span className="relative inline-flex shrink-0">
              <input
                type="checkbox"
                checked={!!sheets?.auto_sync}
                disabled={toggleAuto.isPending}
                onChange={(e) => toggleAuto.mutate(e.target.checked)}
                className="peer sr-only"
              />
              <span
                className={`h-5 w-9 rounded-full transition-colors duration-150 ${
                  sheets?.auto_sync ? "bg-gain" : "bg-paper-deep"
                } peer-disabled:opacity-50`}
              />
              <span
                className={`pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-surface shadow-sm transition-transform duration-150 ${
                  sheets?.auto_sync ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            {sheets?.spreadsheet_url && (
              <a
                href={sheets.spreadsheet_url}
                target="_blank"
                rel="noopener noreferrer"
                className="smallcaps rounded-full border border-paper-rule bg-surface px-4 py-1.5 text-ink-soft hover:bg-paper-deep hover:text-ink transition-all duration-150 active:scale-95"
              >
                Open in Google Sheets
              </a>
            )}
            <button
              onClick={() => syncNow.mutate()}
              disabled={syncNow.isPending}
              className="smallcaps rounded-full border border-paper-rule bg-surface px-4 py-1.5 text-ink-soft hover:bg-paper-deep hover:text-gain transition-all duration-150 active:scale-95 disabled:opacity-50"
            >
              {syncNow.isPending ? "Syncing…" : "Sync now"}
            </button>
            {lastSynced && <span className="text-ink-mute">Last synced {lastSynced}</span>}
          </div>
          {syncNow.isError && (
            <p className="text-accent">{(syncNow.error as Error).message || "Sync failed."}</p>
          )}
          {sheets?.last_sync_error && !syncNow.isError && (
            <p className="text-accent">Last sync error: {sheets.last_sync_error}</p>
          )}
        </div>
      )}
      <ConfirmDialog
        open={tgConfirmOpen}
        title="Disconnect Telegram?"
        message="The bot will stop responding to that chat until you connect again."
        confirmLabel="Disconnect"
        busy={disconnectTg.isPending}
        error={disconnectTg.isError ? (disconnectTg.error as Error).message : null}
        onConfirm={() => disconnectTg.mutate()}
        onClose={() => setTgConfirmOpen(false)}
      />
      <ConfirmDialog
        open={gsConfirmOpen}
        title="Disconnect Google Sheets?"
        message="Automatic syncing will stop and we'll revoke access. Your existing spreadsheet stays in your Drive."
        confirmLabel="Disconnect"
        busy={disconnectSheets.isPending}
        error={disconnectSheets.isError ? (disconnectSheets.error as Error).message : null}
        onConfirm={() => disconnectSheets.mutate()}
        onClose={() => setGsConfirmOpen(false)}
      />
    </section>
  );
}

function useMe() {
  return useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/auth/me"),
  });
}

// Mobile Manage → "Sources" sub-tab: currencies + named sources.
export function SourcesSettingsPage() {
  const { data: me } = useMe();
  const sourcesEnabled = me?.sources_enabled !== false;
  return (
    <div>
      <CurrencyBlock sourcesEnabled={sourcesEnabled} />
      <SourcesBlock enabled={sourcesEnabled} />
    </div>
  );
}

// Mobile Manage → "Categories" sub-tab.
export function CategoriesSettingsPage() {
  return (
    <div>
      <CategoriesBlock />
    </div>
  );
}

// Mobile Manage → "Account" sub-tab: preferences + (admin) member approvals.
export function AccountSettingsPage() {
  const { data: me } = useMe();
  return (
    <div className="prefs-compact">
      <section className="mb-12">
        <PreferencesForm me={me} />
      </section>
      <ConnectedAppsBlock />
      {me?.is_admin && <AdminBlock />}
    </div>
  );
}

export default function SettingsPage() {
  // The Manage group fans Settings into sibling sub-tabs on both mobile and
  // desktop, so /settings is just the "Sources" sub-tab; Categories and Account
  // live at their own routes.
  return <SourcesSettingsPage />;
}
