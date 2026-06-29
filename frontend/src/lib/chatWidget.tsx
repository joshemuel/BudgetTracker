import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

// The floating "Ask Leo" widget has three states (Facebook-Messenger style):
//   removed   — gone entirely (the X). Re-summoned from the Chat page.
//   collapsed — minimized: the docked quick-ask bar (desktop) / FAB (mobile).
//   expanded  — the open conversation panel.
// Persisted to localStorage so the choice survives a reload, mirroring the
// sidebar-collapsed pattern.
export type ChatWidgetState = "removed" | "collapsed" | "expanded";

const CHAT_WIDGET_KEY = "bt_chat_widget";

export function useChatWidgetState(): [ChatWidgetState, (s: ChatWidgetState) => void] {
  const [state, setState] = useState<ChatWidgetState>(() => {
    if (typeof window === "undefined") return "collapsed";
    const v = localStorage.getItem(CHAT_WIDGET_KEY);
    return v === "removed" || v === "expanded" ? v : "collapsed";
  });
  const update = useCallback((next: ChatWidgetState) => {
    setState(next);
    if (typeof window !== "undefined") localStorage.setItem(CHAT_WIDGET_KEY, next);
  }, []);
  return [state, update];
}

type ChatWidgetContextValue = {
  state: ChatWidgetState;
  setState: (s: ChatWidgetState) => void;
};

const ChatWidgetContext = createContext<ChatWidgetContextValue | null>(null);

export function ChatWidgetProvider({
  value,
  children,
}: {
  value: ChatWidgetContextValue;
  children: ReactNode;
}) {
  return <ChatWidgetContext.Provider value={value}>{children}</ChatWidgetContext.Provider>;
}

/** Lets a page (e.g. /chat) re-summon or drive the floating widget. */
export function useChatWidget(): ChatWidgetContextValue {
  const ctx = useContext(ChatWidgetContext);
  if (!ctx) throw new Error("useChatWidget must be used within <ChatWidgetProvider>");
  return ctx;
}
