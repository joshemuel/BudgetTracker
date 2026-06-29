import { useEffect, useState } from "react";
import { useIsMobile } from "@/lib/mediaQuery";
import {
  ChatBubbleIcon,
  ChatComposer,
  ChatLog,
  ChevronDownIcon,
  CloseIcon,
  SendIcon,
  TypingDots,
  useChat,
} from "@/components/chat/ChatProvider";
import type { ChatWidgetState } from "@/lib/chatWidget";

// The floating chat surface, Facebook-Messenger style. Three states:
//   removed   → nothing here; re-summoned from the Chat page button.
//   collapsed → docked quick-ask bar (desktop) / FAB (mobile).
//   expanded  → the open conversation panel.
// Clicking the header tab toggles collapse/expand; the X removes it entirely.
// The full-screen conversation lives at /chat — both read one history from
// ChatProvider.
export default function WebChat({
  state,
  onState,
}: {
  state: ChatWidgetState;
  onState: (s: ChatWidgetState) => void;
}) {
  const isMobile = useIsMobile();
  const { sendText, resetSession, stopRecording, busy } = useChat();
  const [draft, setDraft] = useState("");
  const expanded = state === "expanded";

  // Escape collapses the open panel (it never removes the widget).
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onState("collapsed");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, onState]);

  // Drop the mic whenever the panel isn't open.
  useEffect(() => {
    if (!expanded) stopRecording();
  }, [expanded, stopRecording]);

  if (state === "removed") return null;

  if (isMobile) {
    if (!expanded) {
      // Collapsed → floating action button. Pulses while Leo is working.
      return (
        <button
          type="button"
          onClick={() => onState("expanded")}
          data-tutorial="chat-launcher"
          className={
            "chat-fab fixed z-[70] w-14 h-14 rounded-full text-white flex items-center justify-center hover:brightness-110 transition-all duration-150 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
            (busy ? "animate-pulse" : "")
          }
          style={{
            backgroundColor: "var(--section-edge)",
            right: "max(1rem, env(safe-area-inset-right))",
            bottom: "max(1rem, env(safe-area-inset-bottom))",
          }}
          title="Chat with Leo"
          aria-label="Open chat"
        >
          <ChatBubbleIcon />
        </button>
      );
    }
    return (
      <div className="modal-backdrop fixed inset-0 z-[70] flex items-stretch justify-center">
        <div
          className="modal-card w-full mx-3 my-4 flex flex-col"
          style={{ maxHeight: "calc(100dvh - 2rem)" }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-paper-rule">
            {/* Tap the title to minimize to the FAB (Messenger-style). */}
            <button
              type="button"
              onClick={() => onState("collapsed")}
              className="flex items-center gap-2 smallcaps text-ink-mute hover:text-accent transition-colors"
              aria-expanded={true}
              aria-label="Minimize chat"
              title="Minimize"
            >
              <span>Chat with Leo</span>
              {busy ? <TypingDots /> : <ChevronDownIcon />}
            </button>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={resetSession}
                className="smallcaps text-ink-mute hover:text-accent transition-colors"
              >
                new
              </button>
              <button
                type="button"
                onClick={() => onState("removed")}
                className="w-8 h-8 flex items-center justify-center text-ink-mute hover:text-accent transition-colors"
                title="Remove chat"
                aria-label="Remove chat"
              >
                <CloseIcon />
              </button>
            </div>
          </div>
          <ChatLog />
          <ChatComposer autoFocus />
        </div>
      </div>
    );
  }

  // Desktop docked widget — a header tab is always shown; click it to toggle
  // collapse/expand, and the X removes the widget entirely.
  return (
    <div className="fixed bottom-0 right-3 z-[70] w-[min(92vw,360px)] pointer-events-none safe-chat-right">
      <div
        className="pointer-events-auto border border-paper-rule border-b-0 rounded-t-2xl bg-surface overflow-hidden chat-docked flex flex-col"
        data-tutorial="chat-dock"
      >
        <div className="flex items-center justify-between border-b border-paper-rule">
          <button
            type="button"
            onClick={() => onState(expanded ? "collapsed" : "expanded")}
            className="flex-1 flex items-center gap-2 px-3 py-1.5 text-left smallcaps text-ink-mute hover:text-accent transition-colors"
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse chat" : "Expand chat"}
            title={expanded ? "Collapse" : "Expand"}
          >
            <span>Leo</span>
            {busy ? (
              <TypingDots />
            ) : (
              <span className={"transition-transform " + (expanded ? "" : "rotate-180")}>
                <ChevronDownIcon />
              </span>
            )}
          </button>
          <div className="flex items-center gap-3 px-3">
            {expanded && (
              <button
                type="button"
                onClick={resetSession}
                className="smallcaps text-ink-mute hover:text-accent transition-colors"
              >
                new
              </button>
            )}
            <button
              type="button"
              onClick={() => onState("removed")}
              className="w-7 h-7 flex items-center justify-center text-ink-mute hover:text-accent transition-colors"
              title="Remove chat"
              aria-label="Remove chat"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        {expanded ? (
          <div className="flex flex-col" style={{ height: "min(60vh, 420px)" }}>
            <ChatLog />
            <ChatComposer autoFocus />
          </div>
        ) : (
          <form
            className="h-12 flex items-center gap-2 pl-4 pr-2"
            onSubmit={(e) => {
              e.preventDefault();
              const msg = draft.trim();
              onState("expanded");
              if (msg) {
                setDraft("");
                sendText(msg);
              }
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => onState("expanded")}
              placeholder={busy ? "Leo is thinking…" : "Ask Leo…"}
              className="flex-1 bg-transparent text-sm placeholder:text-ink-mute focus:outline-none"
              aria-label="Ask Leo"
            />
            <button
              type="submit"
              className="w-8 h-8 rounded-full flex items-center justify-center text-white hover:brightness-110 transition-all duration-150 active:scale-95"
              style={{ backgroundColor: "var(--section-edge)" }}
              title="Open chat"
              aria-label="Open chat"
            >
              <SendIcon />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
