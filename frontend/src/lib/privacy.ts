import { useCallback, useEffect, useState } from "react";

const KEY = "bt_show_amounts";
const EVENT = "bt-privacy-amounts-changed";

function readStored(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(KEY);
  return raw === "1";
}

function writeStored(value: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, value ? "1" : "0");
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { show: value } }));
}

export function useAmountVisibility() {
  const [showAmounts, setShowAmounts] = useState<boolean>(() => readStored());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      setShowAmounts(readStored());
    };
    const onCustom = () => setShowAmounts(readStored());

    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT, onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT, onCustom as EventListener);
    };
  }, []);

  const toggleAmounts = useCallback(() => {
    writeStored(!showAmounts);
  }, [showAmounts]);

  return { showAmounts, toggleAmounts };
}

export function maskAmount<T extends string>(value: T, mask = "••••••"): T | string {
  return value ? mask : value;
}
