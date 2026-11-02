"use client";

import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import {
  mapApiMessagesToUIMessages,
  mapApiSessionToDomain,
  type ApiMessageItem,
  type ApiSessionItem,
} from "@/lib/chat/client-mappers";
import type { Session } from "@/types";

interface UseChatHistoryOptions {
  currentChatId: string | null;
  ownedChatId: string | null;
  setOwnedChatId: (id: string | null) => void;
  setUiMessages: (messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[])) => void;
  onNotFound: () => void;
  /** Called when the latest reply is still generating server-side (e.g. after a reload) */
  onStreamingReply?: (chatId: string) => void;
}

export function useChatHistory({
  currentChatId,
  ownedChatId,
  setOwnedChatId,
  setUiMessages,
  onNotFound,
  onStreamingReply,
}: UseChatHistoryOptions) {
  const onStreamingReplyRef = useRef(onStreamingReply);
  useEffect(() => {
    onStreamingReplyRef.current = onStreamingReply;
  });

  const [isLoadingMessages, setIsLoadingMessages] = useState(() => Boolean(currentChatId));
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [fetchedSessionMeta, setFetchedSessionMeta] = useState<Session | null>(null);
  // Set when the server refuses a PIN-locked chat; cleared and refetched after unlocking
  const [lockedChatId, setLockedChatId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const lockedRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [prevChatId, setPrevChatId] = useState(currentChatId);
  if (prevChatId !== currentChatId) {
    setPrevChatId(currentChatId);
    setFetchedSessionMeta(null);
    if (!currentChatId && !ownedChatId) {
      setUiMessages([]);
      setOlderCursor(null);
      setIsLoadingOlder(false);
      setIsLoadingMessages(false);
    } else if (currentChatId === ownedChatId || (!currentChatId && ownedChatId)) {
      // Chat session was just created locally by the current user: do not reset messages,
      // and do not set isLoadingMessages to true because the initial message is being streamed.
      setIsLoadingOlder(false);
      setIsLoadingMessages(false);
    } else {
      setUiMessages([]);
      setOwnedChatId(null);
      setOlderCursor(null);
      setIsLoadingOlder(false);
      setIsLoadingMessages(true);
    }
  }

  useEffect(() => {
    if (!currentChatId || currentChatId === ownedChatId) return;

    let active = true;

    (async () => {
      try {
        setIsLoadingMessages(true);
        const messagesRes = await fetch(`/api/v1/chats/${currentChatId}/messages?limit=10`, {
          credentials: "same-origin",
        });

        if (!messagesRes.ok) {
          if (messagesRes.status === 404) {
            onNotFound();
          } else if (messagesRes.status === 403) {
            const err = await messagesRes.json().catch(() => null);
            if (active && err?.error?.details?.reason === "CHAT_LOCKED") {
              lockedRef.current = true;
              setLockedChatId(currentChatId);
            }
          }
          return;
        }

        const json = await messagesRes.json();
        const items: ApiMessageItem[] = json.data ?? [];
        if (!active) return;

        if (json.meta?.session) {
          setFetchedSessionMeta(
            mapApiSessionToDomain({ ...(json.meta.session as ApiSessionItem), messageCount: items.length })
          );
        } else {
          // Graceful fallback for endpoints without embedded session meta
          fetch(`/api/v1/chats/${currentChatId}`, { credentials: "same-origin" })
            .then((r) => (r.ok ? r.json() : null))
            .then((metaJson) => {
              if (active && metaJson?.data) {
                setFetchedSessionMeta(
                  mapApiSessionToDomain({ ...(metaJson.data as ApiSessionItem), messageCount: items.length })
                );
              }
            })
            .catch(() => {});
        }

        setUiMessages(mapApiMessagesToUIMessages(items));
        setOlderCursor(json.meta?.nextCursor ?? null);

        const latest = items[items.length - 1];
        if (latest?.role === "assistant" && latest.status === "streaming") {
          onStreamingReplyRef.current?.(currentChatId);
        }
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
  }, [currentChatId, ownedChatId, onNotFound, setUiMessages, reloadTick]);

  async function handleLoadOlder(options?: {
    limit?: number;
    targetMessageId?: string;
  }) {
    if (!currentChatId || !olderCursor || isLoadingOlder) return;

    const fetchLimit = Math.min(Math.max(1, options?.limit ?? 20), 500);
    const targetMessageId = options?.targetMessageId;
    const scroller = scrollContainerRef.current;
    const prevScrollHeight = scroller?.scrollHeight ?? 0;
    const prevScrollTop = scroller?.scrollTop ?? 0;

    try {
      setIsLoadingOlder(true);
      const res = await fetch(
        `/api/v1/chats/${currentChatId}/messages?limit=${fetchLimit}&cursor=${olderCursor}`,
        { credentials: "same-origin" }
      );
      if (!res.ok) return;

      const json = await res.json();
      const items: ApiMessageItem[] = json.data ?? [];
      if (items.length === 0) {
        setOlderCursor(null);
        return;
      }

      const olderUIMessages = mapApiMessagesToUIMessages(items);
      setUiMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const filteredOlder = olderUIMessages.filter((m) => !existingIds.has(m.id));
        return [...filteredOlder, ...prev];
      });
      setOlderCursor(json.meta?.nextCursor ?? null);

      requestAnimationFrame(() => {
        if (targetMessageId) {
          requestAnimationFrame(() => {
            const targetEl = document.getElementById(`message-${targetMessageId}`);
            if (targetEl) {
              targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          });
          return;
        }
        if (scroller) {
          const newScrollHeight = scroller.scrollHeight;
          scroller.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
        }
      });
    } catch {
      // Failed to load older messages
    } finally {
      setIsLoadingOlder(false);
    }
  }

  return {
    isChatLocked: lockedChatId !== null && lockedChatId === currentChatId,
    retryAfterUnlock: () => {
      lockedRef.current = false;
      setLockedChatId(null);
      setReloadTick((n) => n + 1);
    },
    /** Prompt dismissed: leave the chat unless it was just unlocked */
    cancelUnlock: () => {
      if (lockedRef.current) onNotFound();
    },
    isLoadingMessages,
    olderCursor,
    isLoadingOlder,
    fetchedSessionMeta,
    setFetchedSessionMeta,
    scrollContainerRef,
    handleLoadOlder,
  };
}
