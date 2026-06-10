import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { CHAT_LOGGED_EVENT, CHAT_PREFILL_EVENT } from "@/lib/tutorial";

type Role = "user" | "leo";
export type ChatItem = { id: string; role: Role; text: string };

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAudioMime(rec: MediaRecorder): string {
  if (rec.mimeType && rec.mimeType.trim()) return rec.mimeType;
  return "audio/webm";
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const out = String(reader.result || "");
      const idx = out.indexOf(",");
      resolve(idx >= 0 ? out.slice(idx + 1) : out);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const INITIAL_MESSAGE =
  "Hey. I can log your spending like Telegram. Type a message or record audio.";

type WebChatResponse = {
  ok: boolean;
  messages?: string[];
  /** True when the message booked one or more ledger entries. */
  logged?: boolean;
  error?: string;
};

// The conversation lives here, above both chat surfaces (the full-screen /chat
// route and the docked corner bar), so they share one history — "same
// conversation, smaller window". The draft *input* text stays local to each
// composer so keystrokes don't re-render the whole app under this provider.
type ChatContextValue = {
  items: ChatItem[];
  /** id of the most recent Leo message — the tour spotlights it. */
  lastLeoId: string | null;
  busy: boolean;
  recording: boolean;
  recordErr: string | null;
  recordLabel: string;
  /** Latest tour-prefilled draft; composers seed their input from it. */
  prefillText: string;
  sendText: (message: string) => void;
  toggleRecording: () => void;
  stopRecording: () => void;
  resetSession: () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within <ChatProvider>");
  return ctx;
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<ChatItem[]>([
    { id: uid(), role: "leo", text: INITIAL_MESSAGE },
  ]);
  const [recording, setRecording] = useState(false);
  const [recordErr, setRecordErr] = useState<string | null>(null);
  const [prefillText, setPrefillText] = useState("");

  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioMimeRef = useRef<string>("audio/webm");

  // Leo's tour drafts a practice message; remembered so a composer that mounts
  // *after* the event (the docked panel opening) can still seed from it.
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === "string") setPrefillText(detail);
    };
    window.addEventListener(CHAT_PREFILL_EVENT, onPrefill);
    return () => window.removeEventListener(CHAT_PREFILL_EVENT, onPrefill);
  }, []);

  // After a chat message books entries: refresh everything the new rows touch
  // (same set QuickLog invalidates), THEN tell the tour — its next step lands
  // on /transactions and must find the fresh row.
  const notifyLogged = (res: WebChatResponse) => {
    if (!res.ok || !res.logged) return;
    for (const key of [
      "transactions",
      "overview",
      "sources",
      "currencies",
      "monthly",
      "daily",
      "category-stats",
    ]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
    window.dispatchEvent(new CustomEvent(CHAT_LOGGED_EVENT));
  };

  const appendReplies = (res: WebChatResponse, fallback: string) => {
    if (!res.ok) {
      setItems((prev) => [...prev, { id: uid(), role: "leo", text: res.error || fallback }]);
      return;
    }
    const replies = res.messages ?? [];
    if (!replies.length) {
      setItems((prev) => [...prev, { id: uid(), role: "leo", text: "No response returned." }]);
      return;
    }
    setItems((prev) => [
      ...prev,
      ...replies.map((m) => ({ id: uid(), role: "leo" as const, text: m })),
    ]);
  };

  const postText = useMutation({
    mutationFn: async (message: string) =>
      // The acting user is derived from the session cookie server-side.
      api.post<WebChatResponse>("/telegram/web_chat", { text: message }),
    onSuccess: (res) => {
      notifyLogged(res);
      appendReplies(res, "Failed to process message.");
    },
    onError: (e: Error) => {
      setItems((prev) => [...prev, { id: uid(), role: "leo", text: e.message || "Request failed." }]);
    },
  });

  const postAudio = useMutation({
    mutationFn: async ({ b64, mime }: { b64: string; mime: string }) =>
      api.post<WebChatResponse>("/telegram/web_chat", { audio_b64: b64, audio_mime: mime }),
    onSuccess: (res) => {
      notifyLogged(res);
      appendReplies(res, "Failed to process audio.");
    },
    onError: (e: Error) => {
      setItems((prev) => [...prev, { id: uid(), role: "leo", text: e.message || "Audio request failed." }]);
    },
  });

  const busy = postText.isPending || postAudio.isPending;

  const sendText = (message: string) => {
    const msg = message.trim();
    if (!msg || busy) return;
    setPrefillText(""); // consumed — don't re-seed a stale draft later
    setItems((prev) => [...prev, { id: uid(), role: "user", text: msg }]);
    postText.mutate(msg);
  };

  async function startRecording() {
    setRecordErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      audioMimeRef.current = normalizeAudioMime(recorder);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: audioMimeRef.current });
          if (blob.size === 0) return;
          setItems((prev) => [...prev, { id: uid(), role: "user", text: "[Voice note]" }]);
          const b64 = await toBase64(blob);
          postAudio.mutate({ b64, mime: audioMimeRef.current });
        } catch (e) {
          setRecordErr((e as Error).message || "Failed to process recording");
        } finally {
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
          }
          mediaRef.current = null;
          chunksRef.current = [];
          setRecording(false);
        }
      };

      streamRef.current = stream;
      mediaRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (e) {
      setRecordErr((e as Error).message || "Microphone unavailable");
    }
  }

  function stopRecording() {
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      mediaRef.current.stop();
    }
  }

  function toggleRecording() {
    if (recording) stopRecording();
    else void startRecording();
  }

  function resetSession() {
    setRecordErr(null);
    setPrefillText("");
    stopRecording();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setRecording(false);
    setItems([{ id: uid(), role: "leo", text: INITIAL_MESSAGE }]);
  }

  const recordLabel = recording ? "Stop" : busy ? "…" : "Record";
  const lastLeoId = useMemo(
    () => items.reduce<string | null>((acc, it) => (it.role === "leo" ? it.id : acc), null),
    [items],
  );

  // Value omits the per-keystroke draft on purpose; it only changes on send,
  // reply, record toggle, or a tour prefill — never while typing.
  const value: ChatContextValue = {
    items,
    lastLeoId,
    busy,
    recording,
    recordErr,
    recordLabel,
    prefillText,
    sendText,
    toggleRecording,
    stopRecording,
    resetSession,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7Z" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function ChatBubbleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a8 8 0 0 1-12.2 6.8L3 20l1.3-4.8A8 8 0 1 1 21 12Z" />
    </svg>
  );
}

export { SendIcon };

/** The scrolling message history. Each instance scrolls itself to the newest
 *  line; the latest Leo reply carries the tour's `chat-reply` anchor. */
export function ChatLog() {
  const { items, lastLeoId } = useChat();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items.length]);
  return (
    <div ref={scrollRef} className="chat-log flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-paper/85">
      {items.map((it) => (
        <div
          key={it.id}
          data-tutorial={it.id === lastLeoId ? "chat-reply" : undefined}
          className={
            "max-w-[90%] px-3 py-2 rounded-sm border text-sm whitespace-pre-wrap " +
            (it.role === "user"
              ? "ml-auto bg-ink text-paper border-ink"
              : "mr-auto bg-paper border-paper-rule text-ink")
          }
        >
          {it.text}
        </div>
      ))}
    </div>
  );
}

/** Input row + send/mic + footer. Holds its own draft so typing is local; seeds
 *  from a tour prefill. Carries the tour's `chat-footer` anchor. */
export function ChatComposer({ autoFocus }: { autoFocus?: boolean }) {
  const { sendText, busy, recording, recordErr, recordLabel, toggleRecording, resetSession, prefillText } =
    useChat();
  const [text, setText] = useState(prefillText);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Pick up a tour prefill whether it arrived before or after this mount.
  useEffect(() => {
    if (prefillText) setText(prefillText);
  }, [prefillText]);

  const submit = () => {
    const msg = text.trim();
    if (!msg || busy) return;
    setText("");
    sendText(msg);
  };

  return (
    <div className="p-3 border-t border-paper-rule bg-paper space-y-2" data-tutorial="chat-footer">
      {recordErr && <p className="text-xs text-accent">{recordErr}</p>}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask Leo…"
          className="flex-1 bg-transparent border border-ink/25 rounded px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !text.trim()}
          className="px-3 py-2 bg-ink text-paper rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ink-soft transition-colors flex items-center"
          title="Send"
          aria-label="Send"
        >
          <SendIcon />
        </button>
        <button
          type="button"
          disabled={busy && !recording}
          onClick={toggleRecording}
          className={
            "px-2.5 py-2 rounded border transition-colors flex items-center gap-1.5 smallcaps text-[10px] " +
            (recording
              ? "bg-accent text-paper border-accent"
              : "border-ink/25 text-ink-soft hover:border-accent hover:text-accent")
          }
          title={recordLabel}
          aria-label={recordLabel}
        >
          <MicIcon />
        </button>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-ink-mute">Session-only.</p>
        <button
          type="button"
          onClick={resetSession}
          className="smallcaps text-ink-mute hover:text-accent transition-colors"
        >
          new
        </button>
      </div>
    </div>
  );
}
