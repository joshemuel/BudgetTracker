import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { AdminUser, Category, CurrencyBalance, Me, Source } from "@/types";
import { fmtMoney, formatAmountLive, handleAmountChange } from "@/lib/format";
import { useAmountVisibility } from "@/lib/privacy";
import { useIsMobile } from "@/lib/mediaQuery";
import { SectionTitle } from "@/components/Figure";
import ConfirmDialog from "@/components/ConfirmDialog";
import TrackAsOtherDialog from "@/components/TrackAsOtherDialog";
import PreferencesForm from "@/components/PreferencesForm";

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
    <section className="mb-12">
      <SectionTitle>Currencies</SectionTitle>
      <div className="-mx-2 px-2 sm:mx-0 sm:px-0">
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
                <td className="font-[450]">{c.currency}</td>
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
                    className="w-full bg-transparent border-b border-ink py-1 disabled:opacity-45"
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
                    className="smallcaps text-ink-mute hover:text-accent inline-block p-2 -m-2"
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
                  className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full num"
                />
              </div>
            </label>
            <div className="flex gap-2 mt-5 justify-end">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="smallcaps px-3 py-1 border border-ink/30 rounded"
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
                className="smallcaps px-3 py-1 bg-ink text-paper rounded disabled:opacity-60"
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
  const [confirmTrack, setConfirmTrack] = useState<{
    id: number;
    body: Record<string, unknown>;
  } | null>(null);

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
                    onChange={(e) =>
                      handleAmountChange(e.currentTarget, editCurrency, setEditCurrentFundsInput)
                    }
                    onBlur={() => setEditCurrentFundsInput(normalizeInput(editCurrentFundsInput, editCurrency))}
                    onFocus={() =>
                      setEditCurrentFundsInput(formatAmountLive(editCurrentFundsInput, editCurrency))
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
              onChange={(e) => handleAmountChange(e.currentTarget, currency, setCurrentFundsInput)}
              onBlur={() => setCurrentFundsInput(normalizeInput(currentFundsInput, currency))}
              onFocus={() => setCurrentFundsInput(formatAmountLive(currentFundsInput, currency))}
              className="bg-transparent border-b border-ink py-1 w-full sm:w-40 num"
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

function statusTone(status: AdminUser["status"]): string {
  if (status === "pending") return "text-accent";
  if (status === "rejected") return "text-ink-mute line-through";
  return "text-ink-soft";
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
      <div className="-mx-2 px-2 sm:mx-0 sm:px-0">
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
                <td className="font-[450]">
                  {u.username}
                  {u.is_admin && <span className="smallcaps text-ink-mute"> · admin</span>}
                </td>
                <td className="text-ink-soft">{u.email ?? "—"}</td>
                <td className={`smallcaps ${statusTone(u.status)}`}>{u.status}</td>
                <td className="text-right whitespace-nowrap">
                  {u.status !== "approved" && (
                    <button
                      onClick={() => approve.mutate(u.id)}
                      className="smallcaps text-ink-mute hover:text-gain inline-block p-2 -m-2 mr-1"
                    >
                      approve
                    </button>
                  )}
                  {u.status !== "rejected" && !u.is_admin && (
                    <button
                      onClick={() => reject.mutate(u.id)}
                      className="smallcaps text-ink-mute hover:text-accent inline-block p-2 -m-2"
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
    <div className="max-w-3xl">
      <CurrencyBlock sourcesEnabled={sourcesEnabled} />
      <SourcesBlock enabled={sourcesEnabled} />
    </div>
  );
}

// Mobile Manage → "Categories" sub-tab.
export function CategoriesSettingsPage() {
  return (
    <div className="max-w-3xl">
      <CategoriesBlock />
    </div>
  );
}

// Mobile Manage → "Account" sub-tab: preferences + (admin) member approvals.
export function AccountSettingsPage() {
  const { data: me } = useMe();
  return (
    <div className="max-w-md">
      <section className="mb-12">
        <PreferencesForm me={me} />
      </section>
      {me?.is_admin && <AdminBlock />}
    </div>
  );
}

export default function SettingsPage() {
  const isMobile = useIsMobile();
  const { data: me } = useMe();
  const sourcesEnabled = me?.sources_enabled !== false;

  // On mobile the Manage tab fans these out into sibling sub-tabs, so /settings
  // is just the "Sources" sub-tab. Desktop keeps the full single-page stack.
  if (isMobile) return <SourcesSettingsPage />;

  return (
    <div className="max-w-3xl">
      <CurrencyBlock sourcesEnabled={sourcesEnabled} />
      <SourcesBlock enabled={sourcesEnabled} />
      <CategoriesBlock />
      {me?.is_admin && <AdminBlock />}
    </div>
  );
}
