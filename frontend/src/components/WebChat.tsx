import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import type { Me } from "@/types";
import { useIsMobile } from "@/lib/mediaQuery";

type Role = "user" | "leo";
type ChatItem = { id: string; role: Role; text: string };

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
  error?: string;
};

function SendIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function ChatBubbleIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a8 8 0 0 1-12.2 6.8L3 20l1.3-4.8A8 8 0 1 1 21 12Z" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

export default function WebChat() {
  const { data: me } = useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/auth/me"),
  });
  const isMobile = useIsMobile();

  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [items, setItems] = useState<ChatItem[]>([
    { id: uid(), role: "leo", text: INITIAL_MESSAGE },
  ]);
  const [recording, setRecording] = useState(false);
  const [recordErr, setRecordErr] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioMimeRef = useRef<string>("audio/webm");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) return;
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      mediaRef.current.stop();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [open, items.length]);

  useEffect(() => {
    if (open && !isMobile) {
      inputRef.current?.focus();
    }
  }, [open, isMobile]);

  const postText = useMutation({
    mutationFn: async (message: string) => {
      if (!me?.username) throw new Error("Missing user");
      return api.post<WebChatResponse>("/telegram/web_chat", {
        username: me.username,
        text: message,
      });
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setItems((prev) => [
          ...prev,
          { id: uid(), role: "leo", text: res.error || "Failed to process message." },
        ]);
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
    },
    onError: (e: Error) => {
      setItems((prev) => [...prev, { id: uid(), role: "leo", text: e.message || "Request failed." }]);
    },
  });

  const postAudio = useMutation({
    mutationFn: async ({ b64, mime }: { b64: string; mime: string }) => {
      if (!me?.username) throw new Error("Missing user");
      return api.post<WebChatResponse>("/telegram/web_chat", {
        username: me.username,
        audio_b64: b64,
        audio_mime: mime,
      });
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setItems((prev) => [
          ...prev,
          { id: uid(), role: "leo", text: res.error || "Failed to process audio." },
        ]);
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
    },
    onError: (e: Error) => {
      setItems((prev) => [...prev, { id: uid(), role: "leo", text: e.message || "Audio request failed." }]);
    },
  });

  async function sendText() {
    const msg = text.trim();
    if (!msg || postText.isPending || postAudio.isPending) return;
    setText("");
    setItems((prev) => [...prev, { id: uid(), role: "user", text: msg }]);
    if (!open) setOpen(true);
    postText.mutate(msg);
  }

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
    if (!mediaRef.current) return;
    mediaRef.current.stop();
  }

  function resetSession() {
    setText("");
    setRecordErr(null);
    setRecording(false);
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      mediaRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setItems([{ id: uid(), role: "leo", text: INITIAL_MESSAGE }]);
  }

  const busy = postText.isPending || postAudio.isPending;
  const recordLabel = useMemo(() => {
    if (recording) return "Stop";
    if (busy) return "…";
    return "Record";
  }, [recording, busy]);

  const messageLog = (
    <div
      ref={scrollRef}
      className="chat-log flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-paper/85"
    >
      {items.map((it) => (
        <div
          key={it.id}
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

  const expandedFooter = (
    <div className="p-3 border-t border-paper-rule bg-paper space-y-2">
      {recordErr && <p className="text-xs text-accent">{recordErr}</p>}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendText();
            }
          }}
          placeholder="Ask Leo…"
          className="flex-1 bg-transparent border border-ink/25 rounded px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        />
        <button
          type="button"
          onClick={() => void sendText()}
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
          onClick={() => {
            if (recording) {
              stopRecording();
              return;
            }
            void startRecording();
          }}
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

  if (isMobile) {
    return (
      <>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="chat-fab fixed z-[70] w-[52px] h-[52px] rounded-full bg-ink text-paper flex items-center justify-center hover:bg-ink-soft transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            style={{
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
                    onClick={() => setOpen(false)}
                    className="w-8 h-8 flex items-center justify-center text-ink-mute hover:text-accent transition-colors"
                    title="Close"
                    aria-label="Close chat"
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>
              {messageLog}
              {expandedFooter}
            </div>
          </div>
        )}
      </>
    );
  }

  // Desktop
  return (
    <div className="fixed bottom-0 right-3 z-[70] w-[min(92vw,360px)] pointer-events-none safe-chat-right">
      <div className="pointer-events-auto border border-paper-rule border-b-0 rounded-t-md bg-paper overflow-hidden chat-docked flex flex-col">
        {!open ? (
          <form
            className="h-11 flex items-center gap-2 px-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) {
                void sendText();
              } else {
                setOpen(true);
              }
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendText();
                }
              }}
              placeholder="Ask Leo…"
              className="flex-1 bg-transparent text-sm placeholder:text-ink-mute focus:outline-none"
              aria-label="Ask Leo"
            />
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="w-7 h-7 rounded-sm flex items-center justify-center text-ink-mute hover:text-accent transition-colors"
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
                  onClick={() => setOpen(false)}
                  className="w-7 h-7 flex items-center justify-center text-ink-mute hover:text-accent transition-colors"
                  title="Minimize"
                  aria-label="Minimize chat"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>
            {messageLog}
            {expandedFooter}
          </div>
        )}
      </div>
    </div>
  );
}
