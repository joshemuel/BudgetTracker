import { useEffect, useState } from "react";

/**
 * Resolve the first *visible* element carrying data-tutorial={name}. Desktop
 * and mobile nav can share one name — the hidden twin measures 0×0 and loses.
 * rAF polling (not MutationObserver) because targets appear via route
 * transitions, query loads, AND pure CSS visibility flips.
 */
export function waitForTarget(name: string, timeoutMs = 3500): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const started = performance.now();
    const probe = () => {
      const els = document.querySelectorAll<HTMLElement>(`[data-tutorial="${name}"]`);
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          resolve(el);
          return;
        }
      }
      if (performance.now() - started >= timeoutMs) {
        resolve(null);
        return;
      }
      requestAnimationFrame(probe);
    };
    probe();
  });
}

/** Wait until the element's rect holds still across two frames (post-scroll,
 * post-chart-reflow), bounded so a perpetually animating page can't stall us. */
export function rectStable(el: HTMLElement, timeoutMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now();
    let last: DOMRect | null = null;
    const tick = () => {
      const r = el.getBoundingClientRect();
      const still =
        last !== null &&
        Math.abs(r.top - last.top) < 0.5 &&
        Math.abs(r.left - last.left) < 0.5 &&
        Math.abs(r.width - last.width) < 0.5 &&
        Math.abs(r.height - last.height) < 0.5;
      if (still || performance.now() - started >= timeoutMs) {
        resolve();
        return;
      }
      last = r;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Live viewport rect for the spotlight, polled through rAF while a step is
 * active. Each frame re-resolves the data-tutorial selector when the held
 * node went stale: a query refetch can replace or reorder the tagged element
 * (e.g. tx-row moves down when a newer entry lands), and following the live
 * selector keeps the spotlight on the intended target. setRect only fires on
 * an actual move, so render churn stays at zero while everything holds still. */
export function useAnchorRect(el: HTMLElement | null, name?: string): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!el) {
      setRect(null);
      return;
    }
    let raf = 0;
    let current: HTMLElement = el;
    let last: DOMRect | null = null;
    const measure = () => {
      if (name && (!current.isConnected || current.getAttribute("data-tutorial") !== name)) {
        for (const cand of document.querySelectorAll<HTMLElement>(`[data-tutorial="${name}"]`)) {
          const r = cand.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            current = cand;
            break;
          }
        }
      }
      const r = current.getBoundingClientRect();
      const moved =
        last === null ||
        Math.abs(r.top - last.top) > 0.5 ||
        Math.abs(r.left - last.left) > 0.5 ||
        Math.abs(r.width - last.width) > 0.5 ||
        Math.abs(r.height - last.height) > 0.5;
      if (moved) {
        last = r;
        setRect(r);
      }
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [el, name]);
  return rect;
}
