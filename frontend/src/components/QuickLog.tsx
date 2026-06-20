import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { Category, CurrencyBalance, Me, Source, TxType } from "@/types";
import { fmtMoney, formatAmountLive, handleAmountChange } from "@/lib/format";

function nowLocalISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    "T" +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes())
  );
}

type Props = { open: boolean; onClose: () => void };

const SYMBOL_BY_CURRENCY: Record<string, string> = {
  IDR: "Rp",
  SGD: "S$",
  JPY: "JP¥",
  AUD: "A$",
  TWD: "NT$",
  USD: "US$",
};

function parseRawAmount(raw: string): string {
  const cleaned = raw.replace(/,/g, "").replace(/[^0-9.-]/g, "");
  const neg = cleaned.startsWith("-");
  const unsigned = cleaned.replace(/-/g, "");
  const parts = unsigned.split(".");
  const intPart = parts[0] || "0";
  const fracPart = parts.slice(1).join("");
  return `${neg ? "-" : ""}${intPart}${fracPart ? `.${fracPart}` : ""}`;
}

function displayAmount(raw: string, currency: string): string {
  const code = (currency || "IDR") as "IDR" | "SGD" | "JPY" | "AUD" | "TWD" | "USD";
  const symbol = SYMBOL_BY_CURRENCY[code] ?? code;
  return fmtMoney(parseRawAmount(raw), code).replace(`${symbol} `, "");
}

function normalizeByCurrency(raw: string, currency: string): string {
  const parsed = parseRawAmount(raw);
  if (currency === "JPY") {
    const n = Math.round(Number(parsed || "0"));
    return String(n);
  }
  return parsed;
}

function sourceCurrency(srcs: Source[] | undefined, sourceId: number | ""): string {
  if (!srcs || !sourceId) return "IDR";
  return srcs.find((s) => s.id === Number(sourceId))?.currency ?? "IDR";
}

function firstActiveSourceId(srcs: Source[] | undefined): number | "" {
  return srcs?.find((s) => s.active)?.id ?? "";
}

function defaultSourceId(
  srcs: Source[] | undefined,
  preferredSourceId: number | null | undefined
): number | "" {
  if (!srcs?.length) return "";
  if (preferredSourceId != null) {
    const preferred = srcs.find((s) => s.id === preferredSourceId && s.active);
    if (preferred) return preferred.id;
  }
  return firstActiveSourceId(srcs);
}

function defaultUntrackableCategoryId(cats: Category[] | undefined): number | "" {
  if (!cats?.length) return "";
  const hit = cats.find((c) => {
    const n = c.name.toLowerCase();
    return n === "untrackable" || n === "untracked";
  });
  return hit?.id ?? "";
}

type EntryKind = TxType | "transfer";

export default function QuickLog({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { data: me } = useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/auth/me"),
    enabled: open,
  });
  const { data: cats } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories"),
    enabled: open,
  });
  const { data: srcs } = useQuery<Source[]>({
    queryKey: ["sources"],
    queryFn: () => api.get<Source[]>("/sources"),
    enabled: open,
  });
  const { data: currencies } = useQuery<CurrencyBalance[]>({
    queryKey: ["currencies"],
    queryFn: () => api.get<CurrencyBalance[]>("/currencies"),
    enabled: open,
  });

  const [kind, setKind] = useState<EntryKind>("expense");
  const [amountInput, setAmountInput] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [sourceId, setSourceId] = useState<number | "">("");
  const [currency, setCurrency] = useState<CurrencyBalance["currency"]>("IDR");
  const [toSourceId, setToSourceId] = useState<number | "">("");
  const [description, setDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState(nowLocalISO());
  const [error, setError] = useState<string | null>(null);

  const selectedSource = srcs?.find((s) => s.id === Number(sourceId));
  const sourcesEnabled = me?.sources_enabled !== false;
  const preferredSourceId =
    currencies?.find((row) => row.currency === (me?.default_currency ?? "IDR"))
      ?.default_source_id ?? me?.default_expense_source_id;
  const amountCurrency = sourcesEnabled ? selectedSource?.currency ?? "IDR" : currency;
  const amountSymbol = SYMBOL_BY_CURRENCY[amountCurrency] ?? amountCurrency;

  useEffect(() => {
    if (open) {
      setError(null);
      setKind("expense");
      setAmountInput("");
      setCategoryId("");
      setSourceId("");
      setCurrency(me?.default_currency ?? "IDR");
      setToSourceId("");
      setDescription("");
      setOccurredAt(nowLocalISO());
    }
  }, [open]);

  useEffect(() => {
    if (!open || sourcesEnabled) return;
    const preferred = currencies?.find((row) => row.currency === me?.default_currency);
    const first = preferred ?? currencies?.[0];
    if (first) setCurrency(first.currency);
  }, [currencies, me?.default_currency, open, sourcesEnabled]);

  useEffect(() => {
    if (!open) return;
    setAmountInput(displayAmount(normalizeByCurrency(amountInput, amountCurrency), amountCurrency));
  }, [amountCurrency]);

  useEffect(() => {
    if (!open) return;
    if (!sourcesEnabled && kind === "transfer") {
      setKind("expense");
    }
    if (kind === "transfer" && categoryId) {
      setCategoryId("");
    }
    if (kind !== "transfer" && toSourceId) {
      setToSourceId("");
    }
    if (kind === "transfer" && !sourceId) {
      const first = defaultSourceId(srcs, preferredSourceId);
      if (first) setSourceId(first);
    }
  }, [
    kind,
    open,
    srcs,
    categoryId,
    toSourceId,
    sourceId,
    preferredSourceId,
    sourcesEnabled,
  ]);

  useEffect(() => {
    if (!open) return;
    if (sourcesEnabled && !sourceId) {
      const preferred = defaultSourceId(srcs, preferredSourceId);
      if (preferred) {
        setSourceId(preferred);
      }
    }
    if (kind !== "transfer" && !categoryId) {
      const untrackable = defaultUntrackableCategoryId(cats);
      if (untrackable) {
        setCategoryId(untrackable);
      }
    }
  }, [
    open,
    kind,
    sourceId,
    categoryId,
    srcs,
    cats,
    preferredSourceId,
    sourcesEnabled,
  ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const create = useMutation({
    mutationFn: () =>
      api.post("/transactions", {
        occurred_at: new Date(occurredAt).toISOString(),
        type: kind === "income" ? "income" : "expense",
        category_id: Number(categoryId),
        amount: parseRawAmount(amountInput),
        ...(sourcesEnabled ? { source_id: Number(sourceId) } : { currency }),
        description: description || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["sources"] });
      qc.invalidateQueries({ queryKey: ["currencies"] });
      qc.invalidateQueries({ queryKey: ["monthly"] });
      qc.invalidateQueries({ queryKey: ["daily"] });
      qc.invalidateQueries({ queryKey: ["category-stats"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message || "Could not record entry"),
  });

  const transfer = useMutation({
    mutationFn: () =>
      api.post("/transactions/transfer", {
        occurred_at: new Date(occurredAt).toISOString(),
        amount: parseRawAmount(amountInput),
        from_source_id: Number(sourceId),
        to_source_id: Number(toSourceId),
        description: description || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["sources"] });
      qc.invalidateQueries({ queryKey: ["currencies"] });
      qc.invalidateQueries({ queryKey: ["monthly"] });
      qc.invalidateQueries({ queryKey: ["daily"] });
      qc.invalidateQueries({ queryKey: ["category-stats"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message || "Could not transfer funds"),
  });

  const parsedAmount = Number(parseRawAmount(amountInput));
  const hasAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const isTransfer = kind === "transfer";

  const canSubmitSingle =
    hasAmount &&
    !isTransfer &&
    categoryId &&
    (sourcesEnabled ? sourceId : currency) &&
    !create.isPending;
  const canSubmitTransfer =
    hasAmount && isTransfer && sourceId && toSourceId && sourceId !== toSourceId && !transfer.isPending;

  return (
    <>
      <div
        className={`modal-backdrop fixed inset-0 z-40 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden={!open}
      >
        <div
          className="modal-card w-full max-w-xl max-h-[100dvh] sm:max-h-[90vh] overflow-hidden flex flex-col"
          data-tutorial="quicklog-card"
        >
          <div className="p-4 sm:p-6 sm:pb-4 border-b border-paper-rule">
            <div className="flex items-baseline justify-between smallcaps text-ink-mute">
              <span>New entry</span>
              <button onClick={onClose} className="hover:text-accent transition-colors">
                close · esc
              </button>
            </div>
            <h3 className="display text-3xl sm:text-4xl mt-2 leading-none">
              What should we <span className="display-italic text-accent">log</span> today?
            </h3>
          </div>

          <form
            className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (isTransfer) {
                if (canSubmitTransfer) transfer.mutate();
              } else {
                if (canSubmitSingle) create.mutate();
              }
            }}
          >
            <div>
              <span className="smallcaps text-ink-mute block mb-2">Kind</span>
              <div className="grid grid-cols-3 gap-1 rounded-full bg-paper-deep p-1">
                <button
                  type="button"
                  onClick={() => setKind("expense")}
                  className={`min-h-[44px] py-2 rounded-full smallcaps transition-all duration-150 active:scale-95 ${
                    kind === "expense" ? "bg-accent text-white shadow-sm" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  − Expense
                </button>
                <button
                  type="button"
                  onClick={() => setKind("income")}
                  className={`min-h-[44px] py-2 rounded-full smallcaps transition-all duration-150 active:scale-95 ${
                    kind === "income" ? "bg-gain text-white shadow-sm" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  + Income
                </button>
                <button
                  type="button"
                  onClick={() => setKind("transfer")}
                  disabled={!sourcesEnabled}
                  className={`min-h-[44px] py-2 rounded-full smallcaps transition-all duration-150 active:scale-95 disabled:opacity-40 disabled:active:scale-100 ${
                    kind === "transfer" ? "bg-ink text-paper shadow-sm" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  Transfer
                </button>
              </div>
            </div>

            <label className="block">
              <span className="smallcaps text-ink-mute">Amount · {amountCurrency}</span>
              <div className="mt-1.5 flex items-center gap-3 rounded-xl border border-paper-rule bg-surface-2 px-3 py-1 focus-within:border-accent transition-colors">
                <span className="smallcaps text-ink-mute min-w-10">{amountSymbol}</span>
                <input
                  value={amountInput}
                  onChange={(e) => handleAmountChange(e.currentTarget, amountCurrency, setAmountInput)}
                  onBlur={() => setAmountInput(displayAmount(normalizeByCurrency(amountInput, amountCurrency), amountCurrency))}
                  onFocus={() => setAmountInput(formatAmountLive(amountInput, amountCurrency))}
                  placeholder="0"
                  autoFocus
                  inputMode="decimal"
                  className="w-full bg-transparent py-2 num text-3xl text-ink focus:outline-none"
                />
              </div>
            </label>

            {!isTransfer ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="smallcaps text-ink-mute">Category</span>
                  <select
                    value={categoryId}
                    onChange={(e) =>
                      setCategoryId(e.target.value ? Number(e.target.value) : "")
                    }
                    className="mt-1.5 w-full rounded-xl border border-paper-rule bg-surface px-3 py-2 text-ink focus:outline-none focus:border-accent transition-colors"
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
                    <span className="smallcaps text-ink-mute">Source</span>
                    <select
                      value={sourceId}
                      onChange={(e) => {
                        const nextId = e.target.value ? Number(e.target.value) : "";
                        setSourceId(nextId);
                        const nextCurrency = sourceCurrency(srcs, nextId);
                        setAmountInput(
                          displayAmount(normalizeByCurrency(amountInput, nextCurrency), nextCurrency)
                        );
                      }}
                      className="mt-1 w-full bg-transparent border-b border-ink py-1 focus:outline-none focus:border-accent"
                    >
                      <option value="">—</option>
                      {srcs
                        ?.filter((s) => s.active)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : (
                  <label className="block">
                    <span className="smallcaps text-ink-mute">Currency</span>
                    <select
                      value={currency}
                      onChange={(e) =>
                        setCurrency(e.target.value as CurrencyBalance["currency"])
                      }
                      className="mt-1 w-full bg-transparent border-b border-ink py-1 focus:outline-none focus:border-accent"
                    >
                      {(currencies ?? []).map((row) => (
                        <option key={row.currency} value={row.currency}>
                          {row.currency}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="smallcaps text-ink-mute">From source</span>
                  <select
                    value={sourceId}
                    onChange={(e) => {
                      const nextId = e.target.value ? Number(e.target.value) : "";
                      setSourceId(nextId);
                      const nextCurrency = sourceCurrency(srcs, nextId);
                      setAmountInput(
                        displayAmount(normalizeByCurrency(amountInput, nextCurrency), nextCurrency)
                      );
                    }}
                    className="mt-1.5 w-full rounded-xl border border-paper-rule bg-surface px-3 py-2 text-ink focus:outline-none focus:border-accent transition-colors"
                  >
                    <option value="">—</option>
                    {srcs
                      ?.filter((s) => s.active)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block">
                  <span className="smallcaps text-ink-mute">To source</span>
                  <select
                    value={toSourceId}
                    onChange={(e) => setToSourceId(e.target.value ? Number(e.target.value) : "")}
                    className="mt-1.5 w-full rounded-xl border border-paper-rule bg-surface px-3 py-2 text-ink focus:outline-none focus:border-accent transition-colors"
                  >
                    <option value="">—</option>
                    {srcs
                      ?.filter((s) => s.active)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            )}

            <label className="block">
              <span className="smallcaps text-ink-mute">Occurred at</span>
              <input
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-paper-rule bg-surface px-3 py-2 num text-ink focus:outline-none focus:border-accent transition-colors"
              />
            </label>

            <label className="block">
              <span className="smallcaps text-ink-mute">Note</span>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="coffee at Tanamera, dinner with N…"
                className="mt-1.5 w-full rounded-xl border border-paper-rule bg-surface px-3 py-2 text-ink placeholder:text-ink-mute focus:outline-none focus:border-accent transition-colors"
              />
            </label>

            {error && (
              <p className="text-sm text-accent italic border-l-2 border-accent pl-3">
                {error}
              </p>
            )}
          </form>

          <div className="p-4 sm:p-6 sm:pt-4 border-t border-paper-rule flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 sm:gap-4">
            <button
              type="button"
              onClick={onClose}
              className="smallcaps px-5 py-2 rounded-full border border-paper-rule bg-surface text-ink-soft hover:bg-paper-deep hover:text-ink transition-all duration-150 active:scale-95 w-full sm:w-auto"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (isTransfer) {
                  if (canSubmitTransfer) transfer.mutate();
                } else {
                  if (canSubmitSingle) create.mutate();
                }
              }}
              disabled={isTransfer ? !canSubmitTransfer : !canSubmitSingle}
              className="smallcaps px-5 py-2 rounded-full text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 hover:brightness-110 transition-all duration-150 active:scale-95 w-full sm:w-auto"
              style={{ backgroundColor: "var(--section-edge)" }}
            >
              {isTransfer
                ? transfer.isPending
                ? "Transferring…"
                : "Transfer funds"
                : create.isPending
                ? "Committing…"
                : "Commit to ledger"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
