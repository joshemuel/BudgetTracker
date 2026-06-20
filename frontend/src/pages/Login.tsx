import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/api";
import type { Me } from "@/types";

export default function Login() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [username, setUsername] = useState("josia");
  const [password, setPassword] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);

  const { data: cfg } = useQuery({
    queryKey: ["auth-config"],
    queryFn: () => api.get<{ google_enabled: boolean }>("/auth/config"),
    retry: false,
  });

  const login = useMutation({
    mutationFn: (body: { username: string; password: string }) =>
      api.post<Me>("/auth/login", body),
    onSuccess: (me) => {
      qc.setQueryData(["me"], me);
      nav("/", { replace: true });
    },
  });

  return (
    <div className="min-h-screen grid place-items-center px-6 py-10">
      <div className="w-full max-w-md anim-in card p-8 sm:p-10">
        <div className="text-center">
          <span
            aria-hidden="true"
            className="grid place-items-center w-14 h-14 rounded-2xl shrink-0 shadow-sm mx-auto"
            style={{ backgroundColor: "var(--section-wash)" }}
          >
            <svg viewBox="0 0 32 32" className="w-8 h-8" style={{ color: "var(--section-edge)" }} fill="none">
              <path d="M6 25 L13 16 L18.5 20.5 L26 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="26" cy="7" r="2" fill="currentColor" />
            </svg>
          </span>
          <p className="smallcaps text-ink-mute mt-6">Private Entry</p>
          <h1 className="display text-4xl sm:text-5xl text-ink mt-2">
            Budget Tracker
          </h1>
        </div>

        <form
          className="mt-9 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate({ username, password });
          }}
        >
          <label className="block">
            <span className="smallcaps text-ink-mute">Name</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              className="mt-1.5 w-full rounded-xl border border-paper-rule bg-surface px-3 py-2.5 text-ink focus:outline-none focus:border-accent transition-colors font-[var(--font-display)] text-xl"
            />
          </label>
          <label className="block">
            <span className="smallcaps text-ink-mute">Passphrase</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-paper-rule bg-surface px-3 py-2.5 text-ink focus:outline-none focus:border-accent transition-colors font-[var(--font-mono)] text-lg tracking-[0.2em]"
            />
          </label>

          {login.isError && (
            <p className="text-sm text-accent italic border-l-2 border-accent pl-3">
              {(login.error as Error).message ?? "Something went astray."}
            </p>
          )}

          <button
            type="submit"
            disabled={login.isPending}
            className="w-full py-3 rounded-full text-white smallcaps shadow-sm hover:brightness-110 transition-all duration-150 active:scale-95 disabled:opacity-60"
            style={{ backgroundColor: "var(--section-edge)" }}
          >
            {login.isPending ? "Opening the book…" : "Open the book"}
          </button>

          <div className="text-center">
            <button
              type="button"
              onClick={() => setForgotOpen(true)}
              className="smallcaps text-ink-mute hover:text-accent transition-colors"
            >
              Forgot password?
            </button>
          </div>
        </form>

        {cfg?.google_enabled && (
        <div className="mt-7">
          <div className="flex items-center gap-3 text-ink-mute">
            <span className="flex-1 h-px bg-paper-rule" />
            <span className="smallcaps">or</span>
            <span className="flex-1 h-px bg-paper-rule" />
          </div>
          <a
            href="/api/auth/google/login"
            className="mt-5 w-full inline-flex items-center justify-center gap-3 py-3 rounded-full border border-paper-rule bg-surface text-ink-soft hover:bg-paper-deep hover:text-ink transition-all duration-150 active:scale-95 smallcaps"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 8.1 29.3 6 24 6 14.1 6 6 14.1 6 24s8.1 18 18 18c9.9 0 18-8.1 18-18 0-1.2-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="M8.3 14.7l6.6 4.8C16.7 16.1 20 14 24 14c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 8.1 29.3 6 24 6 16.5 6 10.1 10.2 8.3 14.7z" />
              <path fill="#4CAF50" d="M24 42c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.6 2.4-7.2 2.4-5.2 0-9.6-3.3-11.2-8l-6.5 5C9.9 37.7 16.3 42 24 42z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C39.9 36.5 42 30.8 42 24c0-1.2-.1-2.4-.4-3.5z" />
            </svg>
            Continue with Google
          </a>
          <p className="mt-3 text-center text-ink-mute text-sm leading-relaxed">
            New here? Sign in with Google — an admin approves your account before first entry.
          </p>
        </div>
        )}

        <div className="mt-8 pt-6 border-t border-paper-rule text-center">
          <p className="smallcaps text-ink-mute">
            — entries since MMXXVI —
          </p>
          <a
            href="/privacy.html"
            className="mt-4 inline-block smallcaps px-4 py-1.5 rounded-full border border-paper-rule bg-surface text-ink-mute hover:bg-paper-deep hover:text-ink transition-all duration-150 active:scale-95"
          >
            Privacy Policy
          </a>
        </div>
      </div>

      {forgotOpen && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="modal-card w-full max-w-md p-6">
            <h3 className="display text-2xl text-ink mb-3">Forgot password</h3>
            <p className="text-sm text-ink-soft leading-relaxed mb-3">
              Password recovery isn't automated for this private deployment.
              Please contact the administrator to have your password reset.
            </p>
            <p className="text-sm text-ink-soft leading-relaxed">
              Reach out to{" "}
              <a
                href="mailto:josia.shemuel@gmail.com"
                className="text-accent underline underline-offset-2 decoration-accent"
              >
                josia.shemuel@gmail.com
              </a>{" "}
              with your username and we'll send you a fresh temporary passphrase.
            </p>
            <div className="flex gap-3 mt-6 justify-end">
              <button
                type="button"
                onClick={() => setForgotOpen(false)}
                className="smallcaps px-5 py-2 rounded-full text-white shadow-sm hover:brightness-110 transition-all duration-150 active:scale-95"
                style={{ backgroundColor: "var(--section-edge)" }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
