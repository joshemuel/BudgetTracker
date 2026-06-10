import { ChatComposer, ChatLog, useChat } from "@/components/chat/ChatProvider";
import { SectionTitle } from "@/components/Figure";

// The full-page conversation, reached from the sidebar Chat tab — a route like
// any other page, not a pop-up. Shares its history with the docked corner bar
// through ChatProvider.
export default function ChatPage() {
  const { resetSession } = useChat();
  return (
    <div>
      <div className="flex items-end justify-between">
        <SectionTitle>Chat with Leo</SectionTitle>
        <button
          type="button"
          onClick={resetSession}
          className="smallcaps text-ink-mute hover:text-accent transition-colors"
        >
          new
        </button>
      </div>
      <div
        className="mt-4 flex flex-col border border-paper-rule rounded-md overflow-hidden bg-paper"
        style={{ height: "calc(100dvh - 18rem)", minHeight: 380 }}
      >
        <ChatLog />
        <ChatComposer autoFocus />
      </div>
    </div>
  );
}
