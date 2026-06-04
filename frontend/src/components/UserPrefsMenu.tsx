import { useEffect, useState } from "react";
import type { Me } from "@/types";
import PreferencesForm from "@/components/PreferencesForm";

export default function UserPrefsMenu({ me }: { me: Me | undefined }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 rounded-sm border border-ink text-ink hover:bg-ink hover:text-paper transition-colors flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        title="Preferences"
        aria-label="Preferences"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="3.5" y1="7" x2="13" y2="7" />
          <line x1="17" y1="7" x2="20.5" y2="7" />
          <circle cx="15" cy="7" r="2" fill="currentColor" stroke="none" />
          <line x1="3.5" y1="12" x2="7" y2="12" />
          <line x1="11" y1="12" x2="20.5" y2="12" />
          <circle cx="9" cy="12" r="2" fill="currentColor" stroke="none" />
          <line x1="3.5" y1="17" x2="15" y2="17" />
          <line x1="19" y1="17" x2="20.5" y2="17" />
          <circle cx="17" cy="17" r="2" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close preferences"
            className="fixed inset-0 z-40 bg-ink/25 sm:hidden"
            onClick={() => setOpen(false)}
          />
          <div className="fixed top-14 left-3 right-3 max-h-[calc(100dvh-4rem)] overflow-y-auto bg-paper border border-paper-rule p-3 shadow-lg z-50 sm:absolute sm:top-full sm:left-auto sm:right-0 sm:mt-2 sm:w-72 sm:max-h-none">
            <PreferencesForm me={me} onClose={() => setOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
}
