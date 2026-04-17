import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/api";
import type { Me } from "@/types";

export default function Login() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [username, setUsername] = useState("josia");
  const [password, setPassword] = useState("");

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
          <h1 className="display text-6xl mt-3">
            Budget <span className="display-italic text-accent">Tracker</span>
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
        </form>

        <p className="mt-8 text-center smallcaps text-ink-mute">
          — entries since MMXXVI —
        </p>
      </div>
    </div>
  );
}
