import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/api";
import { useSkin } from "@/lib/theme";
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
  const { skin, setSkin: applySkinLive } = useSkin();
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

  // Theme skin applies instantly and persists on its own (independent of Save),
  // so every A/B choice is captured server-side even if the user doesn't Save.
  const saveSkin = useMutation({
    mutationFn: (next: "editorial" | "pastel") =>
      api.patch<Me>("/auth/me", { theme_skin: next }),
    onSuccess: (updated) => qc.setQueryData(["me"], updated),
  });
  const chooseSkin = (next: "editorial" | "pastel") => {
    applySkinLive(next);
    saveSkin.mutate(next);
  };

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
      <label className="block mb-3">
        <span className="smallcaps text-ink-mute block mb-1">Default Currency</span>
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value as Me["default_currency"])}
          className="w-full rounded-xl border border-paper-rule bg-surface px-3 py-2 focus-visible:outline-none"
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="block mb-4">
        <span className="smallcaps text-ink-mute block mb-1">Default Source</span>
        <select
          value={sourceId}
          disabled={!sourcesEnabled || currencySources.length === 0}
          onChange={(e) => setSourceId(e.target.value ? Number(e.target.value) : "")}
          className="w-full rounded-xl border border-paper-rule bg-surface px-3 py-2 disabled:opacity-45 focus-visible:outline-none"
        >
          {currencySources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      </div>
      <div className="mb-4 border-t border-paper-rule pt-4" data-tutorial="tracking-mode">
        <span className="smallcaps text-ink-mute block mb-2">Tracking mode</span>
        <div className="grid grid-cols-2 gap-1 rounded-full bg-paper-deep p-1">
          <button
            type="button"
            onClick={() => setSourcesEnabled(true)}
            aria-pressed={sourcesEnabled}
            className={`min-h-[28px] sm:min-h-[40px] py-1 sm:py-1.5 smallcaps rounded-full transition-all duration-150 active:scale-95 ${
              sourcesEnabled ? "text-white shadow-sm" : "text-ink-soft hover:text-ink"
            }`}
            style={sourcesEnabled ? { backgroundColor: "var(--section-edge)" } : undefined}
          >
            Wallets &amp; cards
          </button>
          <button
            type="button"
            onClick={() => setSourcesEnabled(false)}
            aria-pressed={!sourcesEnabled}
            className={`min-h-[28px] sm:min-h-[40px] py-1 sm:py-1.5 smallcaps rounded-full transition-all duration-150 active:scale-95 ${
              !sourcesEnabled ? "text-white shadow-sm" : "text-ink-soft hover:text-ink"
            }`}
            style={!sourcesEnabled ? { backgroundColor: "var(--section-edge)" } : undefined}
          >
            By currency
          </button>
        </div>
        <span className="text-xs text-ink-soft block mt-2">
          {sourcesEnabled
            ? "Track named wallets and cards."
            : "Aggregate everything by currency."}
        </span>
      </div>
      <div className="mb-4 border-t border-paper-rule pt-4">
        <span className="smallcaps text-ink-mute block mb-2">Theme</span>
        <div className="grid grid-cols-2 gap-1 rounded-full bg-paper-deep p-1">
          <button
            type="button"
            onClick={() => chooseSkin("editorial")}
            aria-pressed={skin !== "pastel"}
            className={`min-h-[28px] sm:min-h-[40px] py-1 sm:py-1.5 smallcaps rounded-full transition-all duration-150 active:scale-95 ${
              skin !== "pastel" ? "text-white shadow-sm" : "text-ink-soft hover:text-ink"
            }`}
            style={skin !== "pastel" ? { backgroundColor: "var(--section-edge)" } : undefined}
          >
            Editorial
          </button>
          <button
            type="button"
            onClick={() => chooseSkin("pastel")}
            aria-pressed={skin === "pastel"}
            className={`min-h-[28px] sm:min-h-[40px] py-1 sm:py-1.5 smallcaps rounded-full transition-all duration-150 active:scale-95 ${
              skin === "pastel" ? "text-white shadow-sm" : "text-ink-soft hover:text-ink"
            }`}
            style={skin === "pastel" ? { backgroundColor: "var(--section-edge)" } : undefined}
          >
            Pastel
          </button>
        </div>
        <span className="text-xs text-ink-soft block mt-2">
          {skin === "pastel"
            ? "Soft, rounded, modern look."
            : "Warm, editorial classic look."}{" "}
          Switches instantly — we're testing which works best.
        </span>
      </div>
      <div className="flex justify-end gap-2">
        {onClose && (
          <button
            className="smallcaps rounded-full border border-paper-rule bg-surface px-4 py-2 text-ink-soft hover:bg-paper-deep hover:text-ink transition-all duration-150 active:scale-95"
            onClick={onClose}
          >
            Cancel
          </button>
        )}
        <button
          className="smallcaps rounded-full px-4 py-2 text-white shadow-sm hover:brightness-110 transition-all duration-150 active:scale-95 disabled:opacity-60"
          style={{ backgroundColor: "var(--section-edge)" }}
          onClick={() => save.mutate()}
          disabled={save.isPending}
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="mt-4 pt-4 border-t border-paper-rule flex flex-col items-start gap-2">
        <button
          className="smallcaps text-ink-mute hover:text-accent transition-colors duration-150"
          onClick={() => {
            setUname(me?.username ?? "");
            setUnameError(null);
            setUnameOpen(true);
          }}
        >
          Change username →
        </button>
        <button
          className="smallcaps text-ink-mute hover:text-accent transition-colors duration-150"
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
                  className="rounded-xl border border-paper-rule bg-surface px-3 py-2 w-full focus-visible:outline-none"
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
                className="smallcaps rounded-full border border-paper-rule bg-surface px-4 py-2 text-ink-soft hover:bg-paper-deep hover:text-ink transition-all duration-150 active:scale-95 disabled:opacity-60"
                disabled={changeUsername.isPending}
              >
                Cancel
              </button>
              <button
                onClick={submitUsername}
                className="smallcaps rounded-full px-4 py-2 text-white shadow-sm hover:brightness-110 transition-all duration-150 active:scale-95 disabled:opacity-60"
                style={{ backgroundColor: "var(--section-edge)" }}
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
                  className="rounded-xl border border-paper-rule bg-surface px-3 py-2 w-full focus-visible:outline-none"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="smallcaps text-ink-mute block mb-1">New password</span>
                <input
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  className="rounded-xl border border-paper-rule bg-surface px-3 py-2 w-full focus-visible:outline-none"
                />
              </label>
              <label className="block">
                <span className="smallcaps text-ink-mute block mb-1">Confirm new password</span>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  className="rounded-xl border border-paper-rule bg-surface px-3 py-2 w-full focus-visible:outline-none"
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
                className="smallcaps rounded-full border border-paper-rule bg-surface px-4 py-2 text-ink-soft hover:bg-paper-deep hover:text-ink transition-all duration-150 active:scale-95 disabled:opacity-60"
                disabled={changePw.isPending}
              >
                Cancel
              </button>
              <button
                onClick={submitPw}
                className="smallcaps rounded-full px-4 py-2 text-white shadow-sm hover:brightness-110 transition-all duration-150 active:scale-95 disabled:opacity-60"
                style={{ backgroundColor: "var(--section-edge)" }}
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
