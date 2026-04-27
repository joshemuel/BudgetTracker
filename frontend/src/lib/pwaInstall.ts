import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

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

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => isStandaloneMode());
  const [showIosInstructions, setShowIosInstructions] = useState(false);
  const [isIos] = useState<boolean>(() => isIosDevice());

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setShowIosInstructions(false);
    };

    const onDisplayModeChange = () => {
      setIsInstalled(isStandaloneMode());
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    const mql = window.matchMedia("(display-mode: standalone)");
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onDisplayModeChange);
    } else {
      mql.addListener(onDisplayModeChange);
    }

    return () => {
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
    if (isIos) {
      setShowIosInstructions(true);
      return true;
    }
    return false;
  }, [deferredPrompt, isInstalled, isIos]);

  return {
    isInstalled,
    isIos,
    canPrompt: deferredPrompt !== null,
    shouldShowInstall: !isInstalled && (deferredPrompt !== null || isIos),
    showIosInstructions,
    requestInstall,
    closeIosInstructions: () => setShowIosInstructions(false),
  };
}
