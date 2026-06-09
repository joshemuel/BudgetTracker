import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import type { Me } from "@/types";
import { useIsMobile, useMediaQuery } from "@/lib/mediaQuery";
import { isTutorialDone, markTutorialDone, startTutorial, TUTORIAL_START_EVENT } from "@/lib/tutorial";
import Lion from "./Lion";
import { rectStable, useAnchorRect, waitForTarget } from "./anchor";
import { tourSteps, type TourControls } from "./steps";

export { startTutorial };

const CARD_W = 360;
const EDGE = 12; // viewport margin the callout never crosses
const GAP = 14; // gap between spotlight and callout

function renderTitle(title: string) {
  return title.split("*").map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="display-italic text-accent">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export default function Tour({
  me,
  openQuickLog,
  closeQuickLog,
  openChat,
  closeChat,
}: {
  me: Me;
  openQuickLog: () => void;
  closeQuickLog: () => void;
  openChat: () => void;
  closeChat: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  const [active, setActive] = useState(false);
  const [idx, setIdx] = useState(0);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [settled, setSettled] = useState(false);

  // Refs so the step-setup effect depends only on [active, idx].
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const controls = useMemo<TourControls>(
    () => ({ openQuickLog, closeQuickLog, openChat, closeChat, navigate, isMobile }),
    [openQuickLog, closeQuickLog, openChat, closeChat, navigate, isMobile],
  );
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  const seqRef = useRef(0);

  // Auto-start once per user. The timeout survives StrictMode's double-mount
  // (first invocation's timer is cleared by its cleanup) and lets .anim-in settle.
  useEffect(() => {
    if (isTutorialDone(me.id)) return;
    const t = setTimeout(() => {
      setIdx(0);
      setActive(true);
    }, 800);
    return () => clearTimeout(t);
  }, [me.id]);

  // Replay from the masthead "?" or Settings → Account.
  useEffect(() => {
    const onStart = () => {
      setIdx(0);
      setActive(true);
    };
    window.addEventListener(TUTORIAL_START_EVENT, onStart);
    return () => window.removeEventListener(TUTORIAL_START_EVENT, onStart);
  }, []);

  // Step setup: prep → navigate → find target → scroll → wait still → reveal.
  useEffect(() => {
    if (!active) return;
    const step = tourSteps[idx];
    const seq = ++seqRef.current;
    setTarget(null);
    setSettled(false);
    step.before?.(controlsRef.current);
    if (step.route && pathRef.current !== step.route) controlsRef.current.navigate(step.route);
    let cancelled = false;
    (async () => {
      const el = step.target ? await waitForTarget(step.target) : null;
      if (cancelled || seq !== seqRef.current) return;
      if (el) {
        el.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
        await rectStable(el);
        if (cancelled || seq !== seqRef.current) return;
      }
      // QuickLog autofocuses its amount field — drop focus so the phone
      // keyboard doesn't shove the sheet around mid-tour.
      (document.activeElement as HTMLElement | null)?.blur?.();
      setTarget(el);
      setSettled(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, idx]);

  const finish = useCallback(() => {
    tourSteps[idx]?.after?.(controlsRef.current);
    markTutorialDone(me.id);
    setActive(false);
  }, [idx, me.id]);

  const go = useCallback(
    (delta: number) => {
      const next = idx + delta;
      if (next < 0) return;
      tourSteps[idx]?.after?.(controlsRef.current);
      if (next >= tourSteps.length) {
        markTutorialDone(me.id);
        setActive(false);
        return;
      }
      setIdx(next);
    },
    [idx, me.id],
  );

  // Capture-phase keyboard control; stopPropagation keeps Escape/N away from
  // QuickLog, WebChat, and the AppShell shortcut while the tour drives.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        go(-1);
      } else if (e.key === "n" || e.key === "N") {
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, finish, go]);

  const rect = useAnchorRect(target);

  // Measure the card so placement can flip above/below/beside accurately.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardH, setCardH] = useState(230);
  useLayoutEffect(() => {
    if (settled && cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [settled, idx, isMobile]);

  // Focus the dialog on each step; wrap Tab between its controls.
  useEffect(() => {
    if (active && settled) cardRef.current?.focus();
  }, [active, settled, idx]);
  const onCardKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !cardRef.current) return;
    const items = cardRef.current.querySelectorAll<HTMLElement>("button");
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  if (!active) return null;

  const step = tourSteps[idx];
  const pad = step.padding ?? 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Desktop callout placement: below → above → beside, clamped to the viewport.
  let cardStyle: React.CSSProperties;
  if (isMobile) {
    cardStyle = {
      left: EDGE,
      right: EDGE,
      bottom: `calc(64px + env(safe-area-inset-bottom))`,
    };
  } else if (settled && rect) {
    const fitsBelow = rect.bottom + pad + GAP + cardH <= vh - EDGE;
    const fitsAbove = rect.top - pad - GAP - cardH >= EDGE;
    let top: number;
    let left = rect.left + rect.width / 2 - CARD_W / 2;
    if (fitsBelow) top = rect.bottom + pad + GAP;
    else if (fitsAbove) top = rect.top - pad - GAP - cardH;
    else {
      top = Math.min(Math.max(EDGE, rect.top), vh - cardH - EDGE);
      if (rect.right + pad + GAP + CARD_W <= vw - EDGE) left = rect.right + pad + GAP;
      else if (rect.left - pad - GAP - CARD_W >= EDGE) left = rect.left - pad - GAP - CARD_W;
    }
    left = Math.min(Math.max(EDGE, left), vw - CARD_W - EDGE);
    cardStyle = { top, left, width: CARD_W };
  } else {
    cardStyle = { top: vh / 2 - cardH / 2, left: vw / 2 - CARD_W / 2, width: CARD_W };
  }

  return createPortal(
    <div>
      {settled && rect ? (
        <>
          {/* transparent blocker: the hole's box-shadow paints the dim,
              this layer eats every click outside the tour's own buttons */}
          <div className="fixed inset-0 z-[80]" />
          <div
            className="tour-hole z-[81]"
            style={{
              top: rect.top - pad,
              left: rect.left - pad,
              width: rect.width + pad * 2,
              height: rect.height + pad * 2,
            }}
          />
        </>
      ) : (
        <div className="tour-full z-[80]" />
      )}

      {settled && (
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Leo's tour, step ${idx + 1} of ${tourSteps.length}`}
          tabIndex={-1}
          onKeyDown={onCardKeyDown}
          className={
            "modal-card fixed z-[90] p-5 pt-6 outline-none focus:outline-none focus-visible:outline-none " +
            (reducedMotion ? "" : "anim-in")
          }
          style={cardStyle}
        >
          {/* Leo perches on the card's top-left corner, stamped on a paper seal */}
          {!isMobile && (
            <div className="absolute -top-9 left-4 w-[72px] h-[72px] rounded-full bg-paper border border-ink flex items-center justify-center text-ink">
              <Lion pose={step.pose ?? "point"} size={56} />
            </div>
          )}

          <div className={isMobile ? "" : "pl-20"}>
            <div className="flex items-baseline justify-between gap-3 smallcaps text-ink-mute">
              <span>
                Leo's tour · {idx + 1} / {tourSteps.length}
              </span>
              <button onClick={finish} className="hover:text-accent transition-colors">
                skip
              </button>
            </div>

            <div className={isMobile ? "mt-2 flex items-start gap-3" : "mt-2"}>
              {isMobile && (
                <span className="shrink-0 w-12 h-12 rounded-full bg-paper border border-ink flex items-center justify-center text-ink">
                  <Lion pose={step.pose ?? "point"} size={40} />
                </span>
              )}
              <div>
                <h3 className="display text-2xl sm:text-[26px] leading-tight">
                  {renderTitle(step.title)}
                </h3>
                <p className="text-sm text-ink-soft leading-snug mt-2">{step.body}</p>
              </div>
            </div>
          </div>

          <div className="mt-4 h-[3px] bg-paper-deep">
            <div
              className="h-full bg-accent transition-[width] duration-300"
              style={{ width: `${((idx + 1) / tourSteps.length) * 100}%` }}
            />
          </div>

          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={() => go(-1)}
              className={
                "smallcaps text-ink-mute hover:text-ink transition-colors " +
                (idx === 0 ? "invisible" : "")
              }
            >
              ← Back
            </button>
            <button
              onClick={() => go(1)}
              className="smallcaps px-5 py-2 bg-ink text-paper hover:bg-accent transition-colors"
            >
              {idx === tourSteps.length - 1 ? "Finish" : "Next →"}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
