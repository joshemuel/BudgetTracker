import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { Category, Source, TxType } from "@/types";

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

export default function QuickLog({ open, onClose }: Props) {
  const qc = useQueryClient();
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

  const [type, setType] = useState<TxType>("expense");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [sourceId, setSourceId] = useState<number | "">("");
  const [description, setDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState(nowLocalISO());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setAmount("");
      setDescription("");
      setOccurredAt(nowLocalISO());
    }
  }, [open]);

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
        type,
        category_id: Number(categoryId),
        amount,
        source_id: Number(sourceId),
        description: description || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["sources"] });
      qc.invalidateQueries({ queryKey: ["monthly"] });
      qc.invalidateQueries({ queryKey: ["daily"] });
      qc.invalidateQueries({ queryKey: ["categoryStats"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message || "Could not record entry"),
  });

  const canSubmit = amount && categoryId && sourceId && !create.isPending;

  return (
    <>
      <div
        className={`fixed inset-0 bg-ink/40 z-40 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[460px] bg-paper border-l border-ink transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="absolute inset-0 flex flex-col">
          <div className="p-6 pb-4 border-b border-paper-rule">
            <div className="flex items-baseline justify-between smallcaps text-ink-mute">
              <span>New entry</span>
              <button onClick={onClose} className="hover:text-accent">
                close · esc
              </button>
            </div>
            <h3 className="display text-4xl mt-2 leading-none">
              Record a <span className="display-italic text-accent">line</span>.
            </h3>
            <p className="text-sm text-ink-soft mt-2 italic">
              One transaction, entered by hand. Numbers without witness do not count.
            </p>
          </div>

          <form
            className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) create.mutate();
            }}
          >
            <div>
              <span className="smallcaps text-ink-mute block mb-2">Kind</span>
              <div className="grid grid-cols-2 border border-ink">
                <button
                  type="button"
                  onClick={() => setType("expense")}
                  className={`py-2 smallcaps border-r border-ink ${
                    type === "expense" ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  − Expense
                </button>
                <button
                  type="button"
                  onClick={() => setType("income")}
                  className={`py-2 smallcaps ${
                    type === "income" ? "bg-gain text-paper" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  + Income
                </button>
              </div>
            </div>

            <label className="block">
              <span className="smallcaps text-ink-mute">Amount · IDR</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                autoFocus
                className="mt-1 w-full bg-transparent border-b-2 border-ink py-2 num text-3xl focus:outline-none focus:border-accent"
              />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="smallcaps text-ink-mute">Category</span>
                <select
                  value={categoryId}
                  onChange={(e) =>
                    setCategoryId(e.target.value ? Number(e.target.value) : "")
                  }
                  className="mt-1 w-full bg-transparent border-b border-ink py-1 focus:outline-none focus:border-accent"
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
                <span className="smallcaps text-ink-mute">Source</span>
                <select
                  value={sourceId}
                  onChange={(e) =>
                    setSourceId(e.target.value ? Number(e.target.value) : "")
                  }
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
            </div>

            <label className="block">
              <span className="smallcaps text-ink-mute">Occurred at</span>
              <input
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                className="mt-1 w-full bg-transparent border-b border-ink py-1 num focus:outline-none focus:border-accent"
              />
            </label>

            <label className="block">
              <span className="smallcaps text-ink-mute">Note</span>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="coffee at Tanamera, dinner with N…"
                className="mt-1 w-full bg-transparent border-b border-ink py-1 focus:outline-none focus:border-accent"
              />
            </label>

            {error && (
              <p className="text-sm text-accent italic border-l-2 border-accent pl-3">
                {error}
              </p>
            )}
          </form>

          <div className="p-6 pt-4 border-t border-paper-rule flex items-center justify-end gap-4">
            <button
              type="button"
              onClick={onClose}
              className="smallcaps text-ink-mute hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => canSubmit && create.mutate()}
              disabled={!canSubmit}
              className="smallcaps px-5 py-2 bg-ink text-paper disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent transition-colors"
            >
              {create.isPending ? "Committing…" : "Commit to ledger"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
