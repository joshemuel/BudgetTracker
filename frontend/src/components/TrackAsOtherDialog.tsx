import { useEffect } from "react";

type Props = {
  open: boolean;
  busy?: boolean;
  /** Record the balance delta under the "Other" category (counts in summaries). */
  onTrack: () => void;
  /** Keep the previous behavior: record under "Untrackable" (hidden from summaries). */
  onKeepUntracked: () => void;
  /** Abort without saving the balance change. */
  onCancel: () => void;
};

/**
 * Asked when a user changes a balance directly in Settings. The difference has to
 * land somewhere; this lets them decide whether it shows up in downstream summaries.
 */
export default function TrackAsOtherDialog({
  open,
  busy = false,
  onTrack,
  onKeepUntracked,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="modal-card w-full max-w-md p-6">
        <h3 className="font-semibold mb-2">Track this change?</h3>
        <p className="text-sm text-ink-soft mb-5">
          You changed the balance directly. Record the difference under{" "}
          <strong>Others</strong> so it appears in your income, expenditure, and category
          summaries? Choose &ldquo;Keep untracked&rdquo; to leave it out of summaries (the
          previous behavior).
        </p>
        <div className="flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="smallcaps px-3 py-1 border border-ink/30 rounded"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onKeepUntracked}
            className="smallcaps px-3 py-1 border border-ink/30 rounded disabled:opacity-60"
            disabled={busy}
          >
            Keep untracked
          </button>
          <button
            type="button"
            onClick={onTrack}
            className="smallcaps px-3 py-1 bg-ink text-paper rounded disabled:opacity-60"
            disabled={busy}
          >
            {busy ? "Working..." : "Track as Others"}
          </button>
        </div>
      </div>
    </div>
  );
}
