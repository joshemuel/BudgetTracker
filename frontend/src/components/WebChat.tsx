import { useEffect, useState } from "react";
import { useIsMobile } from "@/lib/mediaQuery";
import {
  ChatBubbleIcon,
  ChatComposer,
  ChatLog,
  CloseIcon,
  SendIcon,
  useChat,
} from "@/components/chat/ChatProvider";

// The floating chat surface: a docked bar in the desktop bottom-right corner
// that expands into a compact panel, and a bottom FAB → modal on mobile. The
// full-screen conversation lives at the /chat route (the sidebar Chat tab), not
// here — both read the same history from ChatProvider.
export default function WebChat({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const { sendText, resetSession, stopRecording } = useChat();
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Drop the mic when the surface closes.
  useEffect(() => {
    if (!open) stopRecording();
  }, [open, stopRecording]);

  if (isMobile) {
    return (
      <>
        {!open && (
          <button
            type="button"
            onClick={() => onOpenChange(true)}
            data-tutorial="chat-launcher"
            className="chat-fab fixed z-[70] w-14 h-14 rounded-full text-white flex items-center justify-center hover:brightness-110 transition-all duration-150 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
        )}
        {open && (
          <div className="modal-backdrop fixed inset-0 z-[70] flex items-stretch justify-center">
            <div
              className="modal-card w-full mx-3 my-4 flex flex-col"
              style={{ maxHeight: "calc(100dvh - 2rem)" }}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-paper-rule">
                <span className="smallcaps text-ink-mute">Chat with Leo</span>
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
                    onClick={() => onOpenChange(false)}
                    className="w-8 h-8 flex items-center justify-center text-ink-mute hover:text-accent transition-colors"
                    title="Close"
                    aria-label="Close chat"
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>
              <ChatLog />
              <ChatComposer autoFocus />
            </div>
          </div>
        )}
      </>
    );
  }

  // Desktop docked bar.
  return (
    <div className="fixed bottom-0 right-3 z-[70] w-[min(92vw,360px)] pointer-events-none safe-chat-right">
      <div
        className="pointer-events-auto border border-paper-rule border-b-0 rounded-t-2xl bg-surface overflow-hidden chat-docked flex flex-col"
        data-tutorial="chat-dock"
      >
        {!open ? (
          <form
            className="h-12 flex items-center gap-2 pl-4 pr-2"
            onSubmit={(e) => {
              e.preventDefault();
              const msg = draft.trim();
              onOpenChange(true);
              if (msg) {
                setDraft("");
                sendText(msg);
              }
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => onOpenChange(true)}
              placeholder="Ask Leo…"
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
        ) : (
          <div className="flex flex-col" style={{ height: "min(60vh, 420px)" }}>
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-paper-rule">
              <span className="smallcaps text-ink-mute">Leo</span>
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
                  onClick={() => onOpenChange(false)}
                  className="w-7 h-7 flex items-center justify-center text-ink-mute hover:text-accent transition-colors"
                  title="Minimize"
                  aria-label="Minimize chat"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>
            <ChatLog />
            <ChatComposer autoFocus />
          </div>
        )}
      </div>
    </div>
  );
}
