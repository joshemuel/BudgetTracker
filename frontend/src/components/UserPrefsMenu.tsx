import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { Me, Source } from "@/types";

const CURRENCIES = ["IDR", "SGD", "JPY", "AUD", "TWD"] as const;

export default function UserPrefsMenu({ me }: { me: Me | undefined }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [currency, setCurrency] = useState<Me["default_currency"]>("IDR");
  const [sourceId, setSourceId] = useState<number | "">("");

  const { data: sources } = useQuery<Source[]>({
    queryKey: ["sources"],
    queryFn: () => api.get<Source[]>('/sources'),
  });

  useEffect(() => {
    if (!me) return;
    setCurrency(me.default_currency || "IDR");
    setSourceId(me.default_expense_source_id ?? "");
  }, [me]);

  const save = useMutation({
    mutationFn: () =>
      api.patch<Me>('/auth/me', {
        default_currency: currency,
        default_expense_source_id: sourceId || null,
      }),
    onSuccess: async (updated) => {
      qc.setQueryData(["me"], updated);
      qc.removeQueries({ queryKey: ["overview"] });
      qc.removeQueries({ queryKey: ["monthly"] });
      qc.removeQueries({ queryKey: ["daily"] });
      qc.removeQueries({ queryKey: ["category-stats"] });
      await Promise.all([
        qc.refetchQueries({ queryKey: ["me"] }),
        qc.refetchQueries({ queryKey: ["sources"] }),
        qc.refetchQueries({ queryKey: ["overview"], type: "active" }),
        qc.refetchQueries({ queryKey: ["monthly"], type: "active" }),
        qc.refetchQueries({ queryKey: ["daily"], type: "active" }),
        qc.refetchQueries({ queryKey: ["category-stats"], type: "active" }),
      ]);
      setOpen(false);
    },
  });

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 rounded-full border border-ink text-ink hover:bg-ink hover:text-paper transition-colors flex items-center justify-center"
        title="Preferences"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="3.5" />
          <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1.5 1.5 0 1 1-2.1 2.1l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V19a1.5 1.5 0 1 1-3 0v-.1a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1.5 1.5 0 0 1-2.1-2.1l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H5a1.5 1.5 0 1 1 0-3h.1a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1.5 1.5 0 1 1 2.1-2.1l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V5a1.5 1.5 0 1 1 3 0v.1a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1.5 1.5 0 1 1 2.1 2.1l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6H19a1.5 1.5 0 1 1 0 3h-.1a1 1 0 0 0-.9.6Z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-paper border border-paper-rule p-3 shadow-lg z-50">
          <p className="smallcaps text-ink-mute mb-2">Preferences</p>
          <label className="block mb-2">
            <span className="smallcaps text-ink-mute block mb-1">Default Currency</span>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Me["default_currency"])}
              className="w-full bg-transparent border-b border-ink py-1"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="block mb-3">
            <span className="smallcaps text-ink-mute block mb-1">Default Expense Source (Telegram)</span>
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value ? Number(e.target.value) : "")}
              className="w-full bg-transparent border-b border-ink py-1"
            >
              <option value="">Auto</option>
              {(sources ?? [])
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <button className="smallcaps text-ink-mute" onClick={() => setOpen(false)}>Cancel</button>
            <button
              className="smallcaps px-3 py-1 bg-ink text-paper"
              onClick={() => save.mutate()}
              disabled={save.isPending}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
