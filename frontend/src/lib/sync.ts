import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/api";

const POLL_MS = 8000;
export const SYNC_EVENT = "bt-sync-update";

type SyncResponse = {
  token: number;
};

let intervalId: number | null = null;
let running = false;
let lastToken: number | null = null;

function invalidateLiveQueries(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ["overview"] });
  qc.invalidateQueries({ queryKey: ["monthly"] });
  qc.invalidateQueries({ queryKey: ["daily"] });
  qc.invalidateQueries({ queryKey: ["category-stats"] });
  qc.invalidateQueries({ queryKey: ["sources"] });
  qc.invalidateQueries({ queryKey: ["transactions"] });
  qc.invalidateQueries({ queryKey: ["budgets"] });
}

async function tick(qc: QueryClient): Promise<void> {
  if (running) return;
  running = true;
  try {
    const res = await api.get<SyncResponse>("/stats/sync");
    const token = Number(res?.token ?? 0);
    if (!Number.isFinite(token)) return;

    if (lastToken === null) {
      lastToken = token;
      return;
    }

    if (token > lastToken) {
      lastToken = token;
      invalidateLiveQueries(qc);
      window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { token } }));
      return;
    }

    lastToken = token;
  } catch {
    /* ignore transient polling errors */
  } finally {
    running = false;
  }
}

export function startSyncPolling(qc: QueryClient): () => void {
  if (intervalId !== null) {
    return () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
      lastToken = null;
      running = false;
    };
  }

  void tick(qc);
  intervalId = window.setInterval(() => {
    void tick(qc);
  }, POLL_MS);

  return () => {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
    lastToken = null;
    running = false;
  };
}
