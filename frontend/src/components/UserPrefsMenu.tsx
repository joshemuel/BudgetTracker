import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/api";
import type { Me, Source } from "@/types";

const CURRENCIES = ["IDR", "SGD", "JPY", "AUD", "TWD"] as const;

export default function UserPrefsMenu({ me }: { me: Me | undefined }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Me["default_currency"]>("IDR");
  const [sourceId, setSourceId] = useState<number | "">("");

  const { data: sources } = useQuery<Source[]>({
    queryKey: ["sources"],
    queryFn: () => api.get<Source[]>("/sources"),
  });

  const activeSources = (sources ?? []).filter((s) => s.active);

  useEffect(() => {
    if (!me) return;
    setCurrency(me.default_currency || "IDR");
  }, [me]);

  useEffect(() => {
    if (!me || activeSources.length === 0) return;
    if (me.default_expense_source_id != null) {
      setSourceId(me.default_expense_source_id);
      return;
    }
    const bca = activeSources.find((s) => s.name.toLowerCase() === "bca");
    setSourceId(bca ? bca.id : activeSources[0].id);
  }, [me, sources]);

  const save = useMutation({
    mutationFn: () =>
      api.patch<Me>("/auth/me", {
        default_currency: currency,
        default_expense_source_id: sourceId || null,
      }),
    onSuccess: async (updated) => {
      qc.setQueryData(["me"], updated);
      qc.removeQueries({ queryKey: ["overview"] });
      qc.removeQueries({ queryKey: ["monthly"] });
      qc.removeQueries({ queryKey: ["daily"] });
      qc.removeQueries({ queryKey: ["category-stats"] });
      qc.removeQueries({ queryKey: ["budgets"] });
      await Promise.all([
        qc.refetchQueries({ queryKey: ["me"] }),
        qc.refetchQueries({ queryKey: ["sources"] }),
        qc.refetchQueries({ queryKey: ["budgets"], type: "active" }),
        qc.refetchQueries({ queryKey: ["overview"], type: "active" }),
        qc.refetchQueries({ queryKey: ["monthly"], type: "active" }),
        qc.refetchQueries({ queryKey: ["daily"], type: "active" }),
        qc.refetchQueries({ queryKey: ["category-stats"], type: "active" }),
      ]);
      setOpen(false);
    },
  });

  const changePw = useMutation({
    mutationFn: (body: { current_password: string; new_password: string }) =>
      api.post("/auth/change-password", body),
    onSuccess: () => {
      qc.clear();
      nav("/login", { replace: true });
    },
    onError: (err: Error) => {
      setPwError(err.message || "Couldn't change password");
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        if (!changePw.isPending) {
          setPwOpen(false);
          resetPwForm();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changePw.isPending]);

  function resetPwForm() {
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
    setPwError(null);
  }

  function submitPw() {
    setPwError(null);
    if (newPw.length < 8) {
      setPwError("New password must be at least 8 characters");
      return;
    }
    if (newPw !== confirmPw) {
      setPwError("New passwords don't match");
      return;
    }
    changePw.mutate({ current_password: currentPw, new_password: newPw });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 rounded-sm border border-ink text-ink hover:bg-ink hover:text-paper transition-colors flex items-center justify-center"
        title="Preferences"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="square" strokeLinejoin="miter">
          <path d="M4 8h16" />
          <path d="M4 12h16" />
          <path d="M4 16h16" />
          <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="11" cy="16" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close preferences"
            className="fixed inset-0 z-40 bg-ink/25 sm:hidden"
            onClick={() => setOpen(false)}
          />
          <div className="fixed top-14 left-3 right-3 max-h-[calc(100dvh-4rem)] overflow-y-auto bg-paper border border-paper-rule p-3 shadow-lg z-50 sm:absolute sm:top-full sm:left-auto sm:right-0 sm:mt-2 sm:w-72 sm:max-h-none">
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
              {activeSources.map((s) => (
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
          <div className="mt-3 pt-3 border-t border-paper-rule">
            <button
              className="smallcaps text-ink-mute hover:text-accent"
              onClick={() => {
                setOpen(false);
                resetPwForm();
                setPwOpen(true);
              }}
            >
              Reset password →
            </button>
          </div>
          </div>
        </>
      )}

      {pwOpen && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="modal-card w-full max-w-md p-6">
            <h3 className="font-semibold mb-4">Reset password</h3>
            <div className="space-y-3">
              <label className="block">
                <span className="smallcaps text-ink-mute block mb-1">Current password</span>
                <input
                  type="password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="smallcaps text-ink-mute block mb-1">New password</span>
                <input
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full"
                />
              </label>
              <label className="block">
                <span className="smallcaps text-ink-mute block mb-1">Confirm new password</span>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full"
                />
              </label>
              {pwError && <p className="text-accent text-sm">{pwError}</p>}
              <p className="text-xs text-ink-mute">
                You'll be signed out of every device after the change.
              </p>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button
                onClick={() => {
                  setPwOpen(false);
                  resetPwForm();
                }}
                className="smallcaps px-3 py-1 border border-ink/30 rounded"
                disabled={changePw.isPending}
              >
                Cancel
              </button>
              <button
                onClick={submitPw}
                className="smallcaps px-3 py-1 bg-ink text-paper rounded disabled:opacity-60"
                disabled={changePw.isPending || !currentPw || !newPw || !confirmPw}
              >
                {changePw.isPending ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
