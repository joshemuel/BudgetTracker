import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "bt_theme";
const EVENT = "bt-theme-changed";

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function readStored(): Theme {
  if (typeof window === "undefined") return "light";
  const raw = window.localStorage.getItem(KEY);
  if (raw === "light" || raw === "dark") return raw;
  return systemPrefersDark() ? "dark" : "light";
}

function writeStored(next: Theme): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, next);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { theme: next } }));
}

function apply(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#14110a" : "#f5efe3");
}

export function initTheme(): void {
  apply(readStored());
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => readStored());

  useEffect(() => {
    apply(theme);
  }, [theme]);

  useEffect(() => {
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent).detail as { theme?: Theme } | undefined;
      if (detail?.theme) setTheme(detail.theme);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      setTheme(readStored());
    };
    window.addEventListener(EVENT, onCustom as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onCustom as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    writeStored(next);
  }, [theme]);

  return { theme, toggleTheme };
}
