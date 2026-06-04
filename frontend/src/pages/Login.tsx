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
    <div className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-md anim-in relative">
        <div className="deco-cross" style={{ top: -6, left: -6 }} />
        <div className="deco-cross" style={{ top: -6, right: -6 }} />
        <div className="deco-cross" style={{ bottom: -6, left: -6 }} />
        <div className="deco-cross" style={{ bottom: -6, right: -6 }} />

        <div className="text-center">
          <p className="smallcaps text-ink-mute">Private Entry</p>
          <h1 className="text-5xl font-semibold tracking-tight text-ink mt-3">
            Budget Tracker
          </h1>
          <div className="mt-5 h-[1px] bg-ink mx-auto w-16" />
        </div>

        <form
          className="mt-10 space-y-6"
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
              className="mt-1 w-full bg-transparent border-0 border-b-2 border-ink px-0 py-2 focus:outline-none focus:border-accent font-[var(--font-display)] text-2xl"
            />
          </label>
          <label className="block">
            <span className="smallcaps text-ink-mute">Passphrase</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full bg-transparent border-0 border-b-2 border-ink px-0 py-2 focus:outline-none focus:border-accent font-[var(--font-mono)] text-xl tracking-[0.2em]"
            />
          </label>

          {login.isError && (
            <p className="text-accent text-sm">
              {(login.error as Error).message ?? "Something went astray."}
            </p>
          )}

          <button
            type="submit"
            disabled={login.isPending}
            className="w-full py-3 bg-ink text-paper smallcaps hover:bg-accent transition-colors disabled:opacity-60"
          >
            {login.isPending ? "Opening the book…" : "Open the book"}
          </button>

          <div className="text-center">
            <button
              type="button"
              onClick={() => setForgotOpen(true)}
              className="smallcaps text-ink-mute hover:text-accent"
            >
              Forgot password?
            </button>
          </div>
        </form>

        {cfg?.google_enabled && (
        <div className="mt-8">
          <div className="flex items-center gap-3 text-ink-mute">
            <span className="flex-1 h-px bg-paper-rule" />
            <span className="smallcaps">or</span>
            <span className="flex-1 h-px bg-paper-rule" />
          </div>
          <a
            href="/api/auth/google/login"
            className="mt-6 w-full inline-flex items-center justify-center gap-3 py-3 border border-ink text-ink hover:bg-ink hover:text-paper transition-colors smallcaps"
          >
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 8.1 29.3 6 24 6 14.1 6 6 14.1 6 24s8.1 18 18 18c9.9 0 18-8.1 18-18 0-1.2-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="M8.3 14.7l6.6 4.8C16.7 16.1 20 14 24 14c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 8.1 29.3 6 24 6 16.5 6 10.1 10.2 8.3 14.7z" />
              <path fill="#4CAF50" d="M24 42c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.6 2.4-7.2 2.4-5.2 0-9.6-3.3-11.2-8l-6.5 5C9.9 37.7 16.3 42 24 42z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C39.9 36.5 42 30.8 42 24c0-1.2-.1-2.4-.4-3.5z" />
            </svg>
            Continue with Google
          </a>
          <p className="mt-3 text-center text-ink-mute text-sm">
            New here? Sign in with Google — an admin approves your account before first entry.
          </p>
        </div>
        )}

        <p className="mt-8 text-center smallcaps text-ink-mute">
          — entries since MMXXVI —
        </p>
        <p className="mt-3 text-center text-ink-mute text-sm">
          <a href="/privacy.html" className="underline underline-offset-2 hover:text-ink">
            Privacy Policy
          </a>
        </p>
      </div>

      {forgotOpen && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="modal-card w-full max-w-md p-6">
            <h3 className="font-semibold mb-4">Forgot password</h3>
            <p className="text-sm text-ink-soft mb-3">
              Password recovery isn't automated for this private deployment.
              Please contact the administrator to have your password reset.
            </p>
            <p className="text-sm text-ink-soft">
              Reach out to{" "}
              <a
                href="mailto:josia.shemuel@gmail.com"
                className="underline decoration-accent"
              >
                josia.shemuel@gmail.com
              </a>{" "}
              with your username and we'll send you a fresh temporary passphrase.
            </p>
            <div className="flex gap-2 mt-5 justify-end">
              <button
                type="button"
                onClick={() => setForgotOpen(false)}
                className="smallcaps px-3 py-1 bg-ink text-paper rounded"
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
