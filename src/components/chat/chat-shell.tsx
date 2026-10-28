"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type DynamicToolUIPart, type UIMessage } from "ai";
import { Sidebar } from "@/components/sidebar/sidebar";
import { ChatTopbar } from "./chat-topbar";
import { Composer } from "./composer";
import { MessageList } from "./message-list";
import { Welcome } from "./welcome";
import { ChatMessagesSkeleton } from "./chat-skeleton";
import { useI18n } from "@/providers/i18n-provider";
import { useAccount } from "@/providers/account-provider";
import { getLocalStorage, setLocalStorage } from "@/lib/storage";
import { useToast } from "@/providers/toast-provider";
import type { Message, ReasoningLevel, Session, ToolActivity } from "@/types";

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
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
  parts?: unknown;
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

/**
 * Extracts concatenated text content from an AI SDK UIMessage.
 */
function extractUIMessageText(msg: UIMessage): string {
  let text = "";
  for (const part of msg.parts) {
    if (part.type === "text") {
      text += part.text;
    }
  }
  return text;
}

// Map message creation timestamps by message ID to preserve real creation time across streaming
const messageTimestamps = new Map<string, string>();

/**
 * Maps an array of AI SDK UIMessages into the UI's simple Message format.
 */
function mapUIMessagesToDomain(uiMessages: UIMessage[]): Message[] {
  return uiMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      let createdAt = messageTimestamps.get(m.id);
      if (!createdAt) {
        createdAt = new Date().toISOString();
        messageTimestamps.set(m.id, createdAt);
      }
      let reasoning = "";
      let isReasoningStreaming = false;
      const toolCalls: ToolActivity[] = [];

      for (const part of m.parts) {
        if (part.type === "reasoning") {
          reasoning += (reasoning && part.text ? "\n\n" : "") + part.text;
          if (part.state === "streaming") isReasoningStreaming = true;
        } else if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
          const tool = part as DynamicToolUIPart;
          toolCalls.push({
            id: tool.toolCallId,
            name: tool.toolName ?? part.type.slice("tool-".length),
            state:
              tool.state === "input-streaming"
                ? "streaming"
                : tool.state === "output-available"
                  ? "completed"
                  : tool.state === "output-error"
                    ? "error"
                    : "running",
            input: tool.input,
            output: tool.state === "output-available" ? tool.output : undefined,
            error: tool.state === "output-error" ? tool.errorText : undefined,
          });
        }
      }

      return {
        id: m.id,
        role: m.role as "user" | "assistant",
        content: extractUIMessageText(m),
        createdAt,
        reasoning: reasoning || null,
        isReasoningStreaming,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    });
}

/**
 * Maps database messages to AI SDK UIMessage format.
 */
function mapApiMessagesToUIMessages(items: ApiMessageItem[]): UIMessage[] {
  return items
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      messageTimestamps.set(m.id, m.createdAt);

      let parsedSavedParts: unknown[] = [];
      if (typeof m.parts === "string" && m.parts.trim().length > 0) {
        try {
          const json = JSON.parse(m.parts);
          if (Array.isArray(json)) parsedSavedParts = json;
        } catch {}
      } else if (Array.isArray(m.parts)) {
        parsedSavedParts = m.parts;
      }

      return {
        id: m.id,
        role: m.role as "user" | "assistant",
        parts: [
          ...(m.reasoning
            ? [{ type: "reasoning" as const, text: m.reasoning, state: "done" as const }]
            : []),
          // Rehydrate persisted tool activity parts (e.g. interactive_quiz or search)
          ...(parsedSavedParts as any[]),
          {
            type: "text",
            text: m.content,
            state: "done",
          },
        ],
      };
    });
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

  // Live sessions list from API
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);

  // Extract current chat publicId from /c/[id]
  const currentChatId = useMemo(() => {
    if (!pathname || pathname === "/") return null;
    const parts = pathname.split("/");
    return parts[1] === "c" && parts[2] ? parts[2] : null;
  }, [pathname]);

  // Loading state when opening / switching between chat sessions
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  // Stored selection, or the first catalog model when it is missing/no longer active
  const currentModelId =
    models.length === 0 || models.some((m) => m.id === storedModelId)
      ? storedModelId
      : models[0].id;

  // Track chat created in the current view before URL change completes
  const [ownedChatId, setOwnedChatId] = useState<string | null>(null);
  const activeChatId = currentChatId || ownedChatId;

  // Stable transport wired to the active chat endpoint or root fallback
  const chatTransport = useMemo(
    () =>
      new DefaultChatTransport({
        api: activeChatId ? `/api/v1/chats/${activeChatId}/messages` : "/api/v1/chats",
        credentials: "same-origin",
        prepareSendMessagesRequest: ({ id, messages: reqMessages, trigger, messageId }) => {
          const effectiveChatId = activeChatId || id;
          if (trigger === "regenerate-message" && messageId) {
            return {
              api: `/api/v1/chats/${effectiveChatId}/messages/${messageId}/regenerate`,
              body: {
                model: currentModelId || undefined,
                reasoningLevel: reasoningLevel || undefined,
              },
            };
          }
          const lastUser = [...reqMessages].reverse().find((m) => m.role === "user");
          const text = lastUser ? extractUIMessageText(lastUser) : "";
          return {
            api: `/api/v1/chats/${effectiveChatId}/messages`,
            body: {
              content: text,
              model: currentModelId || undefined,
              reasoningLevel: reasoningLevel || undefined,
            },
          };
        },
      }),
    [activeChatId, currentModelId, reasoningLevel]
  );

  // Refresh session list from `/api/v1/chats`
  const fetchSessions = useCallback(() => {
    loadSessions().then((items) => {
      if (items) setSessions(items);
    });
  }, []);

  // Hook into AI SDK useChat
  const {
    messages: uiMessages,
    setMessages: setUiMessages,
    sendMessage,
    regenerate,
    stop,
    status,
  } = useChat({
    id: activeChatId ?? undefined,
    transport: chatTransport,
    throttle: 30,
    onError: (err) => {
      toast(errorMessage(err, "Failed to process message"));
    },
    onFinish: () => {
      fetchSessions();
    },
  });

  // Track the ID of the assistant message being streamed or pending
  const streamingId = useMemo(() => {
    if (status !== "submitted" && status !== "streaming") return null;
    const lastMsg = uiMessages[uiMessages.length - 1];
    return lastMsg?.role === "assistant" ? lastMsg.id : null;
  }, [status, uiMessages]);

  const isThinking = status === "submitted";

  // Opening a different chat drops the previous chat's messages
  const [prevChatId, setPrevChatId] = useState(currentChatId);
  if (prevChatId !== currentChatId) {
    setPrevChatId(currentChatId);
    if (currentChatId !== ownedChatId) {
      setUiMessages([]);
      setOwnedChatId(null);
    }
  }

  useEffect(() => {
    let active = true;
    loadSessions().then((items) => {
      if (active) {
        if (items) setSessions(items);
        setIsLoadingSessions(false);
      }
    });
    return () => {
      active = false;
    };
  }, [pathname]);

  // Fetch initial messages when opening `/c/[id]` (limit to latest 10 messages for fast initial load)
  useEffect(() => {
    if (!currentChatId || currentChatId === ownedChatId) return;

    let active = true;

    (async () => {
      try {
        setIsLoadingMessages(true);
        const res = await fetch(`/api/v1/chats/${currentChatId}/messages?limit=10`, {
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

        setUiMessages(mapApiMessagesToUIMessages(items));
      } catch {
        // Failed to load messages
      } finally {
        if (active) {
          setIsLoadingMessages(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [currentChatId, ownedChatId, router, setUiMessages]);

  const activeSession = useMemo(() => {
    if (!currentChatId) return null;
    return sessions.find((s) => s.id === currentChatId || s.slug === currentChatId);
  }, [currentChatId, sessions]);

  const currentTitle = activeSession?.title || t("welcome.title");

  // Send message via AI SDK useChat
  const handleSend = useCallback(
    async (text: string) => {
      let targetChatId = currentChatId || ownedChatId;

      try {
        // If on home page, create session first so targetChatId is established
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
          window.history.pushState(null, "", `/c/${targetChatId}`);
          fetchSessions();
        }

        await sendMessage({ text });
      } catch (err) {
        toast(errorMessage(err, "Failed to process message"));
      }
    },
    [currentChatId, ownedChatId, currentModelId, sendMessage, fetchSessions, toast]
  );

  // Stop the in-flight generation: notify backend via /stop then abort client-side stream
  const handleStop = useCallback(async () => {
    const chatId = activeChatId;
    const lastMsg = uiMessages[uiMessages.length - 1];
    if (chatId && lastMsg && lastMsg.role === "assistant") {
      fetch(`/api/v1/chats/${chatId}/messages/${lastMsg.id}/stop`, {
        method: "POST",
        credentials: "same-origin",
      }).catch(() => {});
    }
    await stop();
  }, [activeChatId, uiMessages, stop]);

  function handleModelChange(id: string) {
    writePref(MODEL_KEY, id);
  }

  function handleReasoningChange(level: ReasoningLevel) {
    writePref(REASONING_KEY, level);
  }

  // Regenerate assistant response via useChat
  const handleRegenerate = useCallback(
    async (messageId: string) => {
      try {
        await regenerate({ messageId });
      } catch (err) {
        toast(errorMessage(err, "Failed to regenerate"));
      }
    },
    [regenerate, toast]
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

  const domainMessages = useMemo(() => mapUIMessagesToDomain(uiMessages), [uiMessages]);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[var(--surface)]">
      <Sidebar
        sessions={sessions}
        isLoadingSessions={isLoadingSessions}
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
          {isLoadingMessages ? (
            <ChatMessagesSkeleton />
          ) : domainMessages.length === 0 && !isThinking ? (
            <Welcome onSelectPrompt={handleSend} />
          ) : (
            <MessageList
              messages={domainMessages}
              chatId={currentChatId ?? undefined}
              isThinking={isThinking}
              streamingId={streamingId}
              onRegenerate={handleRegenerate}
            />
          )}
        </div>

        <Composer
          onSend={handleSend}
          onStop={handleStop}
          disabled={status === "submitted" || status === "streaming"}
          currentModelId={currentModelId}
          onModelChange={handleModelChange}
          reasoningLevel={reasoningLevel}
          onReasoningChange={handleReasoningChange}
        />
      </main>
    </div>
  );
}
