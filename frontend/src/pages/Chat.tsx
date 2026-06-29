import { ChatComposer, ChatLog, useChat } from "@/components/chat/ChatProvider";
import { SectionTitle } from "@/components/Figure";
import { useChatWidget } from "@/lib/chatWidget";

// The full-page conversation, reached from the sidebar Chat tab — a route like
// any other page, not a pop-up. Shares its history with the docked corner bar
// through ChatProvider.
export default function ChatPage() {
  const { resetSession } = useChat();
  const { state: widgetState, setState: setWidget } = useChatWidget();
  return (
    <div>
      <div className="flex items-end justify-between">
        <SectionTitle>Chat with Leo</SectionTitle>
        <div className="flex items-center gap-4">
          {/* Re-summon the floating mini chat after it's been removed (the X). */}
          {widgetState === "removed" && (
            <button
              type="button"
              onClick={() => setWidget("collapsed")}
              className="smallcaps text-ink-mute hover:text-accent transition-colors"
              title="Show the floating mini chat on other pages"
            >
              pop out mini chat
            </button>
          )}
          <button
            type="button"
            onClick={resetSession}
            className="smallcaps text-ink-mute hover:text-accent transition-colors"
          >
            new
          </button>
        </div>
      </div>
      <div
        className="card mt-4 flex flex-col overflow-hidden"
        style={{ height: "calc(100dvh - 18rem)", minHeight: 380 }}
      >
        <ChatLog />
        <ChatComposer autoFocus />
      </div>
    </div>
  );
}
