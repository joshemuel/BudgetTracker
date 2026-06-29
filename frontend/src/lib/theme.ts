import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
export type Skin = "editorial" | "pastel";

const KEY = "bt_theme";
const EVENT = "bt-theme-changed";
const SKIN_KEY = "bt_skin";
const SKIN_EVENT = "bt-skin-changed";

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

// Skin is the editorial/pastel A/B axis. Editorial is the product default — it
// is NOT system-derived, so a first-time visitor always lands on editorial.
export function readStoredSkin(): Skin {
  if (typeof window === "undefined") return "editorial";
  return window.localStorage.getItem(SKIN_KEY) === "pastel" ? "pastel" : "editorial";
}

function writeStored(next: Theme): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, next);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { theme: next } }));
}

function writeStoredSkin(next: Skin): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SKIN_KEY, next);
  window.dispatchEvent(new CustomEvent(SKIN_EVENT, { detail: { skin: next } }));
}

// The PWA chrome color depends on BOTH axes; compute it from the DOM so either
// apply() call stays correct regardless of which axis changed.
function syncThemeColor(): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  const dark = el.dataset.theme === "dark";
  const pastel = el.dataset.skin === "pastel";
  const color = pastel ? (dark ? "#11141b" : "#f5f6fb") : dark ? "#1b1813" : "#f5efe3";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
}

function apply(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  syncThemeColor();
}

function applySkin(skin: Skin): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.skin = skin;
  syncThemeColor();
}

export function initTheme(): void {
  apply(readStored());
}

export function initSkin(): void {
  applySkin(readStoredSkin());
}

/** Apply + cache a skin chosen elsewhere (e.g. synced from the server profile). */
export function setSkin(next: Skin): void {
  writeStoredSkin(next);
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

/** The editorial/pastel skin, kept in sync across tabs and the DOM. Charts and
 *  any skin-conditional markup subscribe to this so they re-render on a switch. */
export function useSkin() {
  const [skin, setSkinState] = useState<Skin>(() => readStoredSkin());

  useEffect(() => {
    applySkin(skin);
  }, [skin]);

  useEffect(() => {
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent).detail as { skin?: Skin } | undefined;
      if (detail?.skin) setSkinState(detail.skin);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SKIN_KEY) return;
      setSkinState(readStoredSkin());
    };
    window.addEventListener(SKIN_EVENT, onCustom as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SKIN_EVENT, onCustom as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const changeSkin = useCallback((next: Skin) => {
    writeStoredSkin(next);
  }, []);

  return { skin, setSkin: changeSkin };
}
