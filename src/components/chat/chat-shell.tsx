"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar/sidebar";
import { ChatTopbar } from "./chat-topbar";
import { Composer } from "./composer";
import { MessageList } from "./message-list";
import { Welcome } from "./welcome";
import { useI18n } from "@/providers/i18n-provider";
import { useAccount } from "@/providers/account-provider";
import { getLocalStorage, setLocalStorage } from "@/lib/storage";
import { useToast } from "@/providers/toast-provider";
import type { Message, ReasoningLevel, Session } from "@/types";

interface SsePayload {
  messageId?: string;
  userMessageId?: string;
  delta?: string;
  message?: string;
}

/** Reads a POST-based SSE body and invokes `onEvent` for each complete event block. */
async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, payload: SsePayload) => void
) {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      let eventName = "message";
      let dataStr = "";
      for (const line of block.trim().split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataStr = line.slice(5).trim();
      }
      if (!dataStr) continue;

      let payload: SsePayload;
      try {
        payload = JSON.parse(dataStr) as SsePayload;
      } catch {
        continue;
      }
      onEvent(eventName, payload);
    }
  }
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

function isAbortError(err: unknown) {
  return err instanceof DOMException && err.name === "AbortError";
}

const DEFAULT_MODEL_ID = "";
const DEFAULT_REASONING: ReasoningLevel = "2";
const MODEL_KEY = "devnuby-model";
const REASONING_KEY = "devnuby-reasoning";

// ── Persisted preferences (localStorage) as an external store ───────────────
const prefListeners = new Set<() => void>();

function subscribePrefs(listener: () => void) {
  prefListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    prefListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function writePref<T>(key: string, value: T) {
  setLocalStorage(key, value);
  prefListeners.forEach((l) => l());
}

const readModelPref = () => getLocalStorage(MODEL_KEY, DEFAULT_MODEL_ID);
const readReasoningPref = () => getLocalStorage<ReasoningLevel>(REASONING_KEY, DEFAULT_REASONING);

interface ApiSessionItem {
  id: string; // publicId
  title: string;
  isPinned: boolean;
  catalogModelId: string | null;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface ApiMessageItem {
  id: string; // publicId
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  reasoning?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** Loads the user's chat list; returns null when the request fails. */
async function loadSessions(): Promise<Session[] | null> {
  try {
    const res = await fetch("/api/v1/chats?limit=50", { credentials: "same-origin" });
    if (!res.ok) return null;
    const json = await res.json();
    const items: ApiSessionItem[] = json.data ?? [];

    return items.map((item) => ({
      id: item.id,
      slug: item.id,
      title: item.title,
      updatedAt: item.lastMessageAt || item.updatedAt,
      group: classifyDateGroup(item.lastMessageAt || item.createdAt),
      model: item.catalogModelId || "",
      messages: [],
    }));
  } catch {
    // Offline or network error
    return null;
  }
}

function classifyDateGroup(isoString: string): "today" | "yesterday" | "week" | "earlier" {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0 && date.getDate() === now.getDate()) return "today";
  if (diffDays <= 1) return "yesterday";
  if (diffDays < 7) return "week";
  return "earlier";
}

export function ChatShell() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { models } = useAccount();
  const router = useRouter();
  const pathname = usePathname();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const storedModelId = useSyncExternalStore(subscribePrefs, readModelPref, () => DEFAULT_MODEL_ID);
  const reasoningLevel = useSyncExternalStore(
    subscribePrefs,
    readReasoningPref,
    () => DEFAULT_REASONING
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);

  // Live sessions list from API
  const [sessions, setSessions] = useState<Session[]>([]);
  const abortCtrlRef = useRef<AbortController | null>(null);
  // Chat + assistant message currently streaming, used by the Stop action
  const activeStreamRef = useRef<{ chatId: string; messageId: string } | null>(null);

  // Extract current chat publicId from /c/[id]
  const currentChatId = useMemo(() => {
    if (!pathname || pathname === "/") return null;
    const parts = pathname.split("/");
    return parts[1] === "c" && parts[2] ? parts[2] : null;
  }, [pathname]);

  // Stored selection, or the first catalog model when it is missing/no longer active
  const currentModelId =
    models.length === 0 || models.some((m) => m.id === storedModelId)
      ? storedModelId
      : models[0].id;

  // Chat created by handleSend in this view: its messages are already in state
  const [ownedChatId, setOwnedChatId] = useState<string | null>(null);

  // Opening a different chat drops the previous chat's messages
  const [prevChatId, setPrevChatId] = useState(currentChatId);
  if (prevChatId !== currentChatId) {
    setPrevChatId(currentChatId);
    if (currentChatId !== ownedChatId) {
      setMessages([]);
      setOwnedChatId(null);
    }
  }

  // Refresh session list from `/api/v1/chats`
  const fetchSessions = useCallback(() => {
    loadSessions().then((items) => {
      if (items) setSessions(items);
    });
  }, []);

  useEffect(() => {
    let active = true;
    loadSessions().then((items) => {
      if (active && items) setSessions(items);
    });
    return () => {
      active = false;
    };
  }, [pathname]);

  // Fetch messages when opening `/c/[id]`
  useEffect(() => {
    if (!currentChatId || currentChatId === ownedChatId) return;

    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/v1/chats/${currentChatId}/messages?limit=100`, {
          credentials: "same-origin",
        });
        if (!res.ok) {
          if (res.status === 404) {
            router.push("/");
          }
          return;
        }
        const json = await res.json();
        const items: ApiMessageItem[] = json.data ?? [];
        if (!active) return;

        const mapped: Message[] = items
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            createdAt: m.createdAt,
          }));

        setMessages(mapped);
      } catch {
        // Failed to load messages
      }
    })();

    return () => {
      active = false;
    };
  }, [currentChatId, ownedChatId, router]);

  const activeSession = useMemo(() => {
    if (!currentChatId) return null;
    return sessions.find((s) => s.id === currentChatId || s.slug === currentChatId);
  }, [currentChatId, sessions]);

  const currentTitle = activeSession?.title || t("welcome.title");

  // Consume SSE stream from `/api/v1/chats/[chatId]/messages`
  const handleSend = useCallback(
    async (text: string) => {
      const tempUserId = `u_${Date.now()}`;
      const tempUserMsg: Message = {
        id: tempUserId,
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, tempUserMsg]);
      setIsThinking(true);

      let targetChatId = currentChatId;

      try {
        // 1. If currently on home page "/", create a new chat session first
        if (!targetChatId) {
          const createRes = await fetch("/api/v1/chats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: text.slice(0, 40).trim() || "New chat",
              model: currentModelId || undefined,
            }),
            credentials: "same-origin",
          });

          if (!createRes.ok) {
            const errJson = await createRes.json().catch(() => ({}));
            throw new Error(errJson?.error?.message || "Failed to create chat session");
          }

          const createData = await createRes.json();
          targetChatId = createData.data.id;
          setOwnedChatId(targetChatId);
          // Switch URL to /c/[id] without full page reload
          window.history.pushState(null, "", `/c/${targetChatId}`);
          fetchSessions();
        }

        const abortCtrl = new AbortController();
        abortCtrlRef.current = abortCtrl;

        // 2. POST to `/api/v1/chats/[chatId]/messages` with streaming SSE
        const res = await fetch(`/api/v1/chats/${targetChatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: text,
            model: currentModelId || undefined,
          }),
          signal: abortCtrl.signal,
          credentials: "same-origin",
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData?.error?.message || "Failed to send message");
        }

        if (!res.body) {
          throw new Error("No response body received from server");
        }

        let assistantMessageId: string | null = null;
        let assistantContent = "";

        await readSseStream(res.body, (eventName, payload) => {
          if (eventName === "meta" && payload.messageId) {
            setIsThinking(false);
            const newAssistantId = payload.messageId;
            assistantMessageId = newAssistantId;
            setStreamingId(newAssistantId);
            activeStreamRef.current = { chatId: targetChatId!, messageId: newAssistantId };

            const userMessageId = payload.userMessageId;
            setMessages((prev) => [
              ...prev.map((m) =>
                userMessageId && m.id === tempUserId ? { ...m, id: userMessageId } : m
              ),
              {
                id: newAssistantId,
                role: "assistant",
                content: "",
                createdAt: new Date().toISOString(),
              },
            ]);
          } else if (eventName === "delta") {
            setIsThinking(false);
            assistantContent += payload.delta || "";
            const content = assistantContent;
            const id = assistantMessageId;
            if (id) {
              setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content } : m)));
            }
          } else if (eventName === "error") {
            toast(payload.message || "An error occurred");
          } else if (eventName === "done") {
            setStreamingId(null);
          }
        });

        fetchSessions();
      } catch (err) {
        if (!isAbortError(err)) {
          toast(errorMessage(err, "Failed to process message"));
        }
      } finally {
        setIsThinking(false);
        setStreamingId(null);
        abortCtrlRef.current = null;
        activeStreamRef.current = null;
      }
    },
    [currentChatId, currentModelId, fetchSessions, toast]
  );

  // Stop the in-flight generation: tell the server to abort, then drop the client stream
  const handleStop = useCallback(() => {
    const active = activeStreamRef.current;
    if (active) {
      fetch(`/api/v1/chats/${active.chatId}/messages/${active.messageId}/stop`, {
        method: "POST",
        credentials: "same-origin",
      }).catch(() => {});
    }
    abortCtrlRef.current?.abort();
  }, []);

  function handleModelChange(id: string) {
    writePref(MODEL_KEY, id);
  }

  function handleReasoningChange(level: ReasoningLevel) {
    writePref(REASONING_KEY, level);
  }

  // Regenerate assistant response
  const handleRegenerate = useCallback(
    async (messageId: string) => {
      if (!currentChatId) return;

      setIsThinking(true);
      const abortCtrl = new AbortController();
      abortCtrlRef.current = abortCtrl;

      try {
        const res = await fetch(
          `/api/v1/chats/${currentChatId}/messages/${messageId}/regenerate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: currentModelId || undefined }),
            signal: abortCtrl.signal,
            credentials: "same-origin",
          }
        );

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData?.error?.message || "Failed to regenerate message");
        }

        if (!res.body) return;

        let assistantContent = "";

        // Reset assistant message text in state
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, content: "" } : m))
        );
        setStreamingId(messageId);
        activeStreamRef.current = { chatId: currentChatId, messageId };

        await readSseStream(res.body, (eventName, payload) => {
            if (eventName === "meta") {
              setIsThinking(false);
            } else if (eventName === "delta") {
              setIsThinking(false);
              assistantContent += payload.delta || "";
              const content = assistantContent;
              setMessages((prev) =>
                prev.map((m) => (m.id === messageId ? { ...m, content } : m))
              );
            } else if (eventName === "error") {
              toast(payload.message || "An error occurred");
            } else if (eventName === "done") {
              setStreamingId(null);
            }
        });
      } catch (err) {
        if (!isAbortError(err)) {
          toast(errorMessage(err, "Failed to regenerate"));
        }
      } finally {
        setIsThinking(false);
        setStreamingId(null);
        abortCtrlRef.current = null;
        activeStreamRef.current = null;
      }
    },
    [currentChatId, currentModelId, toast]
  );

  async function handleDeleteChat() {
    if (!currentChatId) return;
    try {
      await fetch(`/api/v1/chats/${currentChatId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      fetchSessions();
      router.push("/");
    } catch {
      router.push("/");
    }
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[var(--surface)]">
      <Sidebar
        sessions={sessions}
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed((v) => !v)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <main className="flex flex-col min-w-0 flex-1 grid-rows-[auto_1fr_auto]">
        <ChatTopbar
          title={currentTitle}
          onToggleSidebar={() => {
            if (typeof window !== "undefined" && window.innerWidth <= 768) {
              setMobileOpen(true);
            } else {
              setIsCollapsed((v) => !v);
            }
          }}
          onDelete={handleDeleteChat}
        />

        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 && !isThinking ? (
            <Welcome onSelectPrompt={handleSend} />
          ) : (
            <MessageList
              messages={messages}
              isThinking={isThinking}
              streamingId={streamingId}
              onRegenerate={handleRegenerate}
            />
          )}
        </div>

        <Composer
          onSend={handleSend}
          onStop={handleStop}
          disabled={isThinking || streamingId !== null}
          currentModelId={currentModelId}
          onModelChange={handleModelChange}
          reasoningLevel={reasoningLevel}
          onReasoningChange={handleReasoningChange}
        />
      </main>
    </div>
  );
}
