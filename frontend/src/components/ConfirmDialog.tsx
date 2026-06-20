import { useEffect } from "react";

type Props = {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  busy = false,
  error,
  onConfirm,
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
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-card w-full max-w-md p-6">
        <h3 className="display text-2xl text-ink mb-3">{title}</h3>
        {message && <p className="text-sm text-ink-soft leading-relaxed mb-4">{message}</p>}
        {error && (
          <p className="text-sm text-accent italic border-l-2 border-accent pl-3 mb-4">{error}</p>
        )}
        <div className="flex gap-3 mt-6 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="smallcaps px-5 py-2 rounded-full border border-paper-rule bg-surface text-ink-soft hover:bg-paper-deep hover:text-ink transition-all duration-150 active:scale-95 disabled:opacity-50"
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="smallcaps px-5 py-2 rounded-full bg-accent text-white shadow-sm hover:brightness-110 transition-all duration-150 active:scale-95 disabled:opacity-60"
            disabled={busy}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
