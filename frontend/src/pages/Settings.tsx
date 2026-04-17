import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { Budget, Category, Source } from "@/types";
import { fmtIDR, fmtMoney } from "@/lib/format";
import { SectionTitle } from "@/components/Figure";

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
  const { data } = useQuery<Source[]>({
    queryKey: ["sources"],
    queryFn: () => api.get<Source[]>("/sources"),
  });
  const [name, setName] = useState("");
  const [isCc, setIsCc] = useState(false);
  const [currentFundsInput, setCurrentFundsInput] = useState("0");
  const [currency, setCurrency] = useState<CurrencyCode>("IDR");
  const [editing, setEditing] = useState<Source | null>(null);
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
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
      <table className="ledger-table mb-4">
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
              <td className="text-right num">{fmtMoney(s.current_balance, s.currency)}</td>
              <td className="text-right">
                <button
                  onClick={() => {
                    setEditing(s);
                    setEditName(s.name);
                    setEditCurrentFundsInput(normalizeInput(String(s.current_balance), s.currency));
                    setEditCurrency(s.currency);
                  }}
                  className="smallcaps text-ink-mute hover:text-accent mr-3"
                >
                  edit
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete ${s.name}?`)) del.mutate(s.id);
                  }}
                  className="smallcaps text-ink-mute hover:text-accent"
                >
                  delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <form
        className="flex flex-wrap items-end gap-3"
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
        <button type="submit" className="smallcaps px-3 py-1 bg-ink text-paper">
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
  const create = useMutation({
    mutationFn: () => api.post("/categories", { name }),
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  return (
    <section className="mt-12">
      <SectionTitle kicker="The taxonomy">Categories</SectionTitle>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 mb-6">
        {data?.map((c) => (
          <li key={c.id} className="flex items-center gap-1">
            <span className="font-[450]">{c.name}</span>
            {c.is_default && <span className="smallcaps text-ink-mute">default</span>}
          </li>
        ))}
      </ul>
      <form
        className="flex items-end gap-3"
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
        <button type="submit" className="smallcaps px-3 py-1 bg-ink text-paper">
          Add
        </button>
      </form>
    </section>
  );
}

function BudgetsBlock() {
  const qc = useQueryClient();
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

  return (
    <section className="mt-12">
      <SectionTitle kicker="The fences">Budgets</SectionTitle>
      <table className="ledger-table mb-4">
        <thead>
          <tr>
            <th>Category</th>
            <th className="text-right">Monthly Limit</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {budgets?.map((b) => (
            <tr key={b.id}>
              <td className="font-[450]">{b.category_name}</td>
              <td className="text-right num">{fmtIDR(b.monthly_limit)}</td>
              <td className="text-right">
                <button
                  onClick={() => del.mutate(b.id)}
                  className="smallcaps text-ink-mute hover:text-accent"
                >
                  delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (categoryId && limit) save.mutate();
        }}
      >
        <label>
          <span className="smallcaps text-ink-mute block">Category</span>
          <select
            value={categoryId}
            onChange={(e) =>
              setCategoryId(e.target.value ? Number(e.target.value) : "")
            }
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
          <input
            type="number"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="bg-transparent border-b border-ink py-1 w-40 num"
          />
        </label>
        <button type="submit" className="smallcaps px-3 py-1 bg-ink text-paper">
          Save
        </button>
      </form>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <div className="max-w-3xl">
      <SourcesBlock />
      <CategoriesBlock />
      <BudgetsBlock />
    </div>
  );
}
