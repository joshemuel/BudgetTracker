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

/** Live viewport rect for the spotlight: ResizeObserver + window resize/scroll
 * (capture catches inner scroll boxes), coalesced through one rAF. */
export function useAnchorRect(el: HTMLElement | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!el) {
      setRect(null);
      return;
    }
    let raf = 0;
    const measure = () => {
      raf = 0;
      setRect(el.getBoundingClientRect());
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, { capture: true });
      if (raf) cancelAnimationFrame(raf);
    };
  }, [el]);
  return rect;
}
