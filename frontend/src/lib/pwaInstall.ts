import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

// Globals populated by public/pwa-install-init.js, which runs before React so
// the native install signals are captured even if they fire pre-hydration.
declare global {
  interface Window {
    __btInstallPrompt?: BeforeInstallPromptEvent | null;
    __btInstalled?: boolean;
  }
}

export type InstallPlatform = "ios" | "android" | "other";

function isStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone =
    typeof navigator !== "undefined" &&
    "standalone" in navigator &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOSByAgent = /iPad|iPhone|iPod/i.test(ua);
  const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return iOSByAgent || iPadOS;
}

function detectPlatform(): InstallPlatform {
  if (isIosDevice()) return "ios";
  if (typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "")) {
    return "android";
  }
  return "other";
}

export function usePwaInstall() {
  // Seed from the early-capture globals so a prompt that fired before this hook
  // mounted (the common case on stock Chrome) is still available.
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => (typeof window !== "undefined" ? window.__btInstallPrompt ?? null : null)
  );
  const [isInstalled, setIsInstalled] = useState<boolean>(
    () =>
      isStandaloneMode() ||
      (typeof window !== "undefined" && window.__btInstalled === true)
  );
  const [showInstructions, setShowInstructions] = useState(false);
  const [platform] = useState<InstallPlatform>(() => detectPlatform());

  useEffect(() => {
    const capturePrompt = () => {
      if (typeof window !== "undefined" && window.__btInstallPrompt) {
        setDeferredPrompt(window.__btInstallPrompt);
      }
    };

    // Native event — fires if it happens after this hook has mounted.
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      window.__btInstallPrompt = event as BeforeInstallPromptEvent;
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setShowInstructions(false);
    };

    const onDisplayModeChange = () => {
      setIsInstalled(isStandaloneMode());
    };

    // Re-broadcast events from the early-capture script (events that fired
    // before React mounted) plus the native events as a backstop.
    window.addEventListener("bt:install-available", capturePrompt);
    window.addEventListener("bt:installed", onInstalled);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    const mql = window.matchMedia("(display-mode: standalone)");
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onDisplayModeChange);
    } else {
      mql.addListener(onDisplayModeChange);
    }

    return () => {
      window.removeEventListener("bt:install-available", capturePrompt);
      window.removeEventListener("bt:installed", onInstalled);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (typeof mql.removeEventListener === "function") {
        mql.removeEventListener("change", onDisplayModeChange);
      } else {
        mql.removeListener(onDisplayModeChange);
      }
    };
  }, []);

  const requestInstall = useCallback(async () => {
    if (isInstalled) return false;
    if (deferredPrompt) {
      const promptEvent = deferredPrompt;
      setDeferredPrompt(null);
      window.__btInstallPrompt = null;
      await promptEvent.prompt();
      try {
        const choice = await promptEvent.userChoice;
        if (choice.outcome === "accepted") {
          setIsInstalled(true);
          return true;
        }
      } catch {
        return false;
      }
      return false;
    }
    // No native prompt available (stock Chrome that didn't fire it, iOS Safari,
    // in-app browsers, …) — guide the user through the manual steps instead.
    setShowInstructions(true);
    return true;
  }, [deferredPrompt, isInstalled]);

  return {
    isInstalled,
    platform,
    // Whether the browser handed us a real prompt (useful for debugging/analytics).
    canPrompt: deferredPrompt !== null,
    // A manual fallback always exists, so offer install whenever not installed.
    // The caller gates on viewport (mobile-only) where appropriate.
    shouldShowInstall: !isInstalled,
    showInstructions,
    requestInstall,
    closeInstructions: () => setShowInstructions(false),
  };
}
