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
const OVERHANG = 36; // px Leo's seal pokes above the card's top edge

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
      // keyboard doesn't shove the sheet around mid-tour. Interactive steps
      // keep focus where the page put it (e.g. the chat input).
      if (!step.interactive) (document.activeElement as HTMLElement | null)?.blur?.();
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

  // Gated steps advance themselves when the page reports the user's action
  // (entry logged / edited / deleted) via a window CustomEvent.
  useEffect(() => {
    if (!active) return;
    const ev = tourSteps[idx].advanceOn;
    if (!ev) return;
    const onDone = () => go(1);
    window.addEventListener(ev, onDone);
    return () => window.removeEventListener(ev, onDone);
  }, [active, idx, go]);

  // Capture-phase keyboard control; stopPropagation keeps Escape/N away from
  // QuickLog, WebChat, and the AppShell shortcut while the tour drives.
  // Interactive steps only claim Escape — typing must reach the page.
  useEffect(() => {
    if (!active) return;
    const interactive = !!tourSteps[idx].interactive;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish();
        return;
      }
      if (interactive) return;
      if (e.key === "ArrowRight" || e.key === "Enter") {
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
  }, [active, idx, finish, go]);

  const rect = useAnchorRect(target, active ? tourSteps[idx]?.target : undefined);

  // Measure the card so placement can flip above/below/beside accurately.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardH, setCardH] = useState(230);
  useLayoutEffect(() => {
    if (settled && cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [settled, idx, isMobile]);

  // Focus the dialog on each step; wrap Tab between its controls.
  // preventScroll: focusing a fixed element otherwise nudges the page to
  // "reveal" it, which scrolled the whole app and pushed the masthead away.
  // Interactive steps leave focus to the page (chat input, edit form).
  useEffect(() => {
    if (active && settled && !tourSteps[idx].interactive)
      cardRef.current?.focus({ preventScroll: true });
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
  const interactive = !!step.interactive;
  const pad = step.padding ?? 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const bodyText = typeof step.body === "function" ? step.body(controls) : step.body;

  // Three placements:
  //  • centered  — no target (welcome/finale fallbacks): flex-centered overlay.
  //  • mobile    — spotlight present: bottom sheet clear of the nav bar.
  //  • anchored  — desktop spotlight: beside/above/below, clamped to viewport.
  const anchored = settled && !!rect;
  const centered = !anchored;
  // Leo's seal pokes OVERHANG px above the card wherever it's perched
  // (everywhere except mobile spotlight sheets) — reserve headroom for it.
  const showBadge = !(anchored && isMobile);

  let cardStyle: React.CSSProperties = {};
  // The card itself never scrolls (that would clip the seal) — the inner
  // content wrapper does. Centered default: viewport minus the wrapper's
  // pt-12 (seal headroom) and pb-4.
  let innerMaxH: React.CSSProperties["maxHeight"] = vh - 48 - 16;
  if (anchored && isMobile && rect) {
    cardStyle = {
      left: EDGE,
      right: EDGE,
      bottom: `calc(64px + env(safe-area-inset-bottom))`,
    };
    innerMaxH = `calc(100dvh - ${rect.bottom + pad + GAP + EDGE}px)`;
    // If the target sits low (little room above the sheet), the sheet would be
    // squashed — fall back to anchoring the sheet just under the spotlight.
    const room = vh - (rect.bottom + pad + GAP) - EDGE;
    if (room < 180) {
      cardStyle = { left: EDGE, right: EDGE, top: EDGE };
      innerMaxH = vh - EDGE * 2;
    }
  } else if (anchored && rect) {
    const minTop = EDGE + OVERHANG;
    const maxH = vh - minTop - EDGE;
    const fitsBelow = rect.bottom + pad + GAP + cardH <= vh - EDGE;
    const fitsAbove = rect.top - pad - GAP - cardH >= minTop;
    let top: number;
    let left = rect.left + rect.width / 2 - CARD_W / 2;
    if (fitsBelow) top = rect.bottom + pad + GAP;
    else if (fitsAbove) top = rect.top - pad - GAP - cardH;
    else {
      top = minTop;
      if (rect.right + pad + GAP + CARD_W <= vw - EDGE) left = rect.right + pad + GAP;
      else if (rect.left - pad - GAP - CARD_W >= EDGE) left = rect.left - pad - GAP - CARD_W;
    }
    top = Math.min(Math.max(minTop, top), Math.max(minTop, vh - Math.min(cardH, maxH) - EDGE));
    left = Math.min(Math.max(EDGE, left), vw - CARD_W - EDGE);
    cardStyle = { top, left, width: CARD_W };
    innerMaxH = maxH;
  }

  const hole = rect
    ? {
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  const card = (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Leo's tour, step ${idx + 1} of ${tourSteps.length}`}
      tabIndex={-1}
      onKeyDown={onCardKeyDown}
      className={
        "modal-card pointer-events-auto " +
        (centered
          ? "w-[min(92vw,400px)] "
          : step.cardBehindModals
            ? "fixed z-[49] "
            : "fixed z-[90] ") +
        (reducedMotion ? "" : "anim-in")
      }
      style={{
        // position: fixed inline beats `.modal-card { position: relative }`, which
        // (declared after the Tailwind import) otherwise wins over the `fixed` class.
        ...cardStyle,
        ...(centered ? {} : { position: "fixed" }),
        // .modal-card scrolls (and would clip Leo's seal flat at the top edge,
        // the crop bug) — scrolling lives on the inner wrapper instead.
        overflow: "visible",
        maxHeight: "none",
        outline: "none",
      }}
    >
      {/* Leo perches on the card's top-left corner, stamped on a paper seal.
          Inline on mobile spotlight sheets where there's no room above. */}
      {showBadge && (
        <div className="absolute -top-9 left-4 w-[72px] h-[72px] rounded-full bg-paper border border-ink flex items-center justify-center text-ink">
          <Lion pose={step.pose ?? "point"} size={56} />
        </div>
      )}

      <div className="overflow-y-auto p-5 pt-6 rounded-[inherit]" style={{ maxHeight: innerMaxH }}>
        <div className={showBadge ? "pl-24 min-h-[44px]" : ""}>
          <div className="flex items-baseline justify-between gap-3 smallcaps text-ink-mute">
            <span>
              Leo's tour · {idx + 1} / {tourSteps.length}
            </span>
            <button onClick={finish} className="hover:text-accent transition-colors">
              skip
            </button>
          </div>

          <div className={!showBadge ? "mt-2 flex items-start gap-3" : "mt-2"}>
            {!showBadge && (
              <span className="shrink-0 w-12 h-12 rounded-full bg-paper border border-ink flex items-center justify-center text-ink">
                <Lion pose={step.pose ?? "point"} size={40} />
              </span>
            )}
            <div>
              <h3 className="display text-2xl sm:text-[26px] leading-tight">
                {renderTitle(step.title)}
              </h3>
              <p className="text-sm text-ink-soft leading-snug mt-2">{bodyText}</p>
            </div>
          </div>
        </div>

        <div className="mt-4 h-[3px] bg-paper-deep">
          <div
            className="h-full bg-accent transition-[width] duration-300"
            style={{ width: `${((idx + 1) / tourSteps.length) * 100}%` }}
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            onClick={() => go(-1)}
            className={
              "smallcaps text-ink-mute hover:text-ink transition-colors " +
              (idx === 0 ? "invisible" : "")
            }
          >
            ← Back
          </button>
          {step.gated ? (
            <span className="smallcaps text-accent text-right">{step.gateHint}</span>
          ) : (
            <button
              onClick={() => go(1)}
              className="smallcaps px-5 py-2 bg-ink text-paper hover:bg-accent transition-colors"
            >
              {idx === tourSteps.length - 1 ? "Finish" : "Next →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(
    <div>
      {anchored && hole ? (
        interactive ? (
          <>
            {/* Four strips tile the screen around the hole: clicks pass through
                the hole to the page, and the app's own modals (z-50/70) float
                above this scrim, undimmed and fully usable. */}
            <div
              className="tour-scrim-strip z-[45]"
              style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }}
            />
            <div
              className="tour-scrim-strip z-[45]"
              style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }}
            />
            <div
              className="tour-scrim-strip z-[45]"
              style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }}
            />
            <div
              className="tour-scrim-strip z-[45]"
              style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }}
            />
            <div
              className="tour-hole z-[46]"
              style={{ ...hole, boxShadow: "none", pointerEvents: "none" }}
            />
          </>
        ) : (
          <>
            {/* transparent blocker: the hole's box-shadow paints the dim,
                this layer eats every click outside the tour's own buttons */}
            <div className="fixed inset-0 z-[80]" />
            <div className="tour-hole z-[81]" style={hole} />
          </>
        )
      ) : (
        // Interactive fallback (target missing): dim without blocking so a
        // gated step can never trap the user behind an unclickable scrim.
        <div
          className="tour-full z-[80]"
          style={interactive ? { zIndex: 45, pointerEvents: "none" } : undefined}
        />
      )}

      {settled &&
        (centered ? (
          // True flex centering — never depends on measured height or scroll.
          // Top padding leaves room for Leo's seal; pointer-events-none so the
          // interactive fallback (pass-through scrim) stays clickable — the
          // card re-enables its own pointer events.
          <div
            className={
              "pointer-events-none fixed inset-0 flex items-center justify-center px-4 pb-4 pt-12 " +
              (step.cardBehindModals ? "z-[49]" : "z-[90]")
            }
          >
            {card}
          </div>
        ) : (
          card
        ))}
    </div>,
    // #root is `z-index: 1; isolation: isolate`, so in-app modals (z-50/70)
    // can never rise above ANY body-level layer. Interactive steps therefore
    // portal INTO #root to share the app's stacking context — that's what
    // lets the edit dialog (z-50) and chat (z-70) paint over the z-45 scrim
    // and over a z-49 card. Passive steps stay on body, above everything.
    interactive ? document.getElementById("root") ?? document.body : document.body,
  );
}
