import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/api";
import type { Me, Source } from "@/types";

const CURRENCIES = ["IDR", "SGD", "JPY", "AUD", "TWD", "USD"] as const;

/**
 * The preferences body — default currency/source, tracking mode, save, and the
 * reset-password flow. Shared by the header gear dropdown (`UserPrefsMenu`) and
 * the mobile Manage → Account tab, so both stay in sync. Pass `onClose` when
 * hosted in a dismissable surface (the dropdown); omit it on a standalone page.
 */
export default function PreferencesForm({
  me,
  onClose,
}: {
  me: Me | undefined;
  onClose?: () => void;
}) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [unameOpen, setUnameOpen] = useState(false);
  const [uname, setUname] = useState("");
  const [unameError, setUnameError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Me["default_currency"]>("IDR");
  const [sourcesEnabled, setSourcesEnabled] = useState(true);
  const [sourceId, setSourceId] = useState<number | "">("");

  const { data: sources } = useQuery<Source[]>({
    queryKey: ["sources"],
    queryFn: () => api.get<Source[]>("/sources"),
  });

  const currencySources = (sources ?? []).filter((s) => s.active && s.currency === currency);

  useEffect(() => {
    if (!me) return;
    setCurrency(me.default_currency || "IDR");
    setSourcesEnabled(me.sources_enabled);
  }, [me]);

  useEffect(() => {
    if (!me || currencySources.length === 0) {
      setSourceId("");
      return;
    }
    const current = currencySources.find((s) => s.id === sourceId);
    if (current) return;
    const saved = currencySources.find((s) => s.id === me.default_expense_source_id);
    const bca = currencySources.find((s) => s.name.toLowerCase() === "bca");
    setSourceId((saved ?? bca ?? currencySources[0]).id);
  }, [me, currencySources, sourceId]);

  const save = useMutation({
    mutationFn: () =>
      api.patch<Me>("/auth/me", {
        default_currency: currency,
        default_expense_source_id: sourceId || null,
        sources_enabled: sourcesEnabled,
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
        qc.refetchQueries({ queryKey: ["currencies"] }),
        qc.refetchQueries({ queryKey: ["budgets"], type: "active" }),
        qc.refetchQueries({ queryKey: ["overview"], type: "active" }),
        qc.refetchQueries({ queryKey: ["monthly"], type: "active" }),
        qc.refetchQueries({ queryKey: ["daily"], type: "active" }),
        qc.refetchQueries({ queryKey: ["category-stats"], type: "active" }),
      ]);
      onClose?.();
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

  const changeUsername = useMutation({
    mutationFn: (username: string) =>
      api.post<Me>("/auth/change-username", { username }),
    onSuccess: (updated) => {
      // Sessions are keyed by user id, so no logout — just refresh the cache;
      // the masthead reads the same ["me"] query and updates reactively.
      qc.setQueryData(["me"], updated);
      setUnameOpen(false);
    },
    onError: (err: Error) => {
      setUnameError(err.message || "Couldn't change username");
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pwOpen && !changePw.isPending) {
        setPwOpen(false);
        resetPwForm();
      } else if (unameOpen && !changeUsername.isPending) {
        setUnameOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changePw.isPending, pwOpen, changeUsername.isPending, unameOpen]);

  function resetPwForm() {
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
    setPwError(null);
  }

  function submitUsername() {
    setUnameError(null);
    const candidate = uname.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(candidate)) {
      setUnameError("Username must be 3–30 characters: letters, numbers, . _ -");
      return;
    }
    changeUsername.mutate(candidate);
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
    <>
      <div data-tutorial="prefs-defaults">
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
        <span className="smallcaps text-ink-mute block mb-1">Default Source</span>
        <select
          value={sourceId}
          disabled={!sourcesEnabled || currencySources.length === 0}
          onChange={(e) => setSourceId(e.target.value ? Number(e.target.value) : "")}
          className="w-full bg-transparent border-b border-ink py-1 disabled:opacity-45"
        >
          {currencySources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      </div>
      <div className="mb-3 border-t border-paper-rule pt-3" data-tutorial="tracking-mode">
        <span className="smallcaps text-ink-mute block mb-1">Tracking mode</span>
        <div className="grid grid-cols-2 border border-ink">
          <button
            type="button"
            onClick={() => setSourcesEnabled(true)}
            aria-pressed={sourcesEnabled}
            className={`min-h-[28px] sm:min-h-[40px] py-1 sm:py-1.5 smallcaps border-r border-ink ${
              sourcesEnabled ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
            }`}
          >
            Wallets &amp; cards
          </button>
          <button
            type="button"
            onClick={() => setSourcesEnabled(false)}
            aria-pressed={!sourcesEnabled}
            className={`min-h-[28px] sm:min-h-[40px] py-1 sm:py-1.5 smallcaps ${
              !sourcesEnabled ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
            }`}
          >
            By currency
          </button>
        </div>
        <span className="text-xs text-ink-soft block mt-1">
          {sourcesEnabled
            ? "Track named wallets and cards."
            : "Aggregate everything by currency."}
        </span>
      </div>
      <div className="flex justify-end gap-2">
        {onClose && (
          <button className="smallcaps text-ink-mute" onClick={onClose}>
            Cancel
          </button>
        )}
        <button
          className="smallcaps px-3 py-1 bg-ink text-paper"
          onClick={() => save.mutate()}
          disabled={save.isPending}
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="mt-3 pt-3 border-t border-paper-rule flex flex-col items-start gap-2">
        <button
          className="smallcaps text-ink-mute hover:text-accent"
          onClick={() => {
            setUname(me?.username ?? "");
            setUnameError(null);
            setUnameOpen(true);
          }}
        >
          Change username →
        </button>
        <button
          className="smallcaps text-ink-mute hover:text-accent"
          onClick={() => {
            resetPwForm();
            setPwOpen(true);
          }}
        >
          Reset password →
        </button>
      </div>

      {unameOpen && (
        <div className="modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="modal-card w-full max-w-md p-6">
            <h3 className="font-semibold mb-4">Change username</h3>
            <div className="space-y-3">
              <label className="block">
                <span className="smallcaps text-ink-mute block mb-1">New username</span>
                <input
                  type="text"
                  value={uname}
                  onChange={(e) => setUname(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !changeUsername.isPending) submitUsername();
                  }}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full"
                  autoFocus
                />
              </label>
              {unameError && <p className="text-accent text-sm">{unameError}</p>}
              <p className="text-xs text-ink-mute">
                3–30 characters: letters, numbers, . _ - (stored lowercase). It's
                the name you sign in with — you'll stay logged in.
              </p>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button
                onClick={() => setUnameOpen(false)}
                className="smallcaps px-3 py-1 border border-ink/30 rounded"
                disabled={changeUsername.isPending}
              >
                Cancel
              </button>
              <button
                onClick={submitUsername}
                className="smallcaps px-3 py-1 bg-ink text-paper rounded disabled:opacity-60"
                disabled={changeUsername.isPending || !uname.trim()}
              >
                {changeUsername.isPending ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pwOpen && (
        <div className="modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4">
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
    </>
  );
}
