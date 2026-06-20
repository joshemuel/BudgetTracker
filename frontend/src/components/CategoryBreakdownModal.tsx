import { useEffect } from "react";
import { CategoriesBreakdown } from "@/pages/Categories";
import type { CurrencyCode } from "@/types";

type Props = {
  open: boolean;
  title: string;
  from: string;
  to: string;
  currency: CurrencyCode;
  onClose: () => void;
};

/**
 * Spending-division pie + per-category table shown on demand (clicking a month
 * bar or a day cell) rather than permanently inline — keeps the dense numbers
 * out of the way until asked for, and reads the same on phone and desktop.
 */
export default function CategoryBreakdownModal({
  open,
  title,
  from,
  to,
  currency,
  onClose,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="modal-card w-full max-w-2xl sm:max-w-3xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="smallcaps text-ink-mute">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full border border-paper-rule bg-surface text-ink-mute hover:text-ink hover:bg-paper-deep transition-all duration-150 active:scale-95 flex items-center justify-center text-xl leading-none shrink-0"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <CategoriesBreakdown from={from} to={to} currency={currency} compact />
      </div>
    </div>
  );
}
