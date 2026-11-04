"use client";

import { useEffect, useRef, useState } from "react";
import {
  mapApiMessagesToUIMessages,
  mapApiSessionToDomain,
  type ApiMessageItem,
  type ApiSessionItem,
} from "@/lib/chat/client-mappers";
import { getChat, isChatBusy, wasCreatedHere } from "@/lib/chat/chat-registry";
import type { Session } from "@/types";

interface UseChatHistoryOptions {
  currentChatId: string | null;
  onNotFound: () => void;
  /** Called when the latest reply is still generating server-side (e.g. after a reload) */
  onStreamingReply?: (chatId: string) => void;
}

/**
 * Loads a chat's stored messages into that chat's own `Chat` instance (see
 * chat-registry). Writes always target the chat they were fetched for, so a slow
 * response for chat A can never land in chat B after the user switched, and a
 * chat that is generating locally keeps its live messages instead of being
 * overwritten by the stored (older) copy.
 */
export function useChatHistory({ currentChatId, onNotFound, onStreamingReply }: UseChatHistoryOptions) {
  const onStreamingReplyRef = useRef(onStreamingReply);
  useEffect(() => {
    onStreamingReplyRef.current = onStreamingReply;
  });

  // A chat started in this tab has its messages locally from the first one on
  const needsInitialLoad = (chatId: string | null) =>
    Boolean(chatId) && !wasCreatedHere(chatId!) && getChat(chatId!).messages.length === 0;

  const [isLoadingMessages, setIsLoadingMessages] = useState(() => needsInitialLoad(currentChatId));
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
    setOlderCursor(null);
    setIsLoadingOlder(false);
    // A chat opened before (or still generating) shows its messages at once
    setIsLoadingMessages(needsInitialLoad(currentChatId));
  }

  useEffect(() => {
    if (!currentChatId || wasCreatedHere(currentChatId)) return;
    const chatId = currentChatId;
    let active = true;

    (async () => {
      try {
        const messagesRes = await fetch(`/api/v1/chats/${chatId}/messages?limit=10`, {
          credentials: "same-origin",
        });

        if (!messagesRes.ok) {
          if (messagesRes.status === 404) {
            if (active) onNotFound();
          } else if (messagesRes.status === 403) {
            const err = await messagesRes.json().catch(() => null);
            if (active && err?.error?.details?.reason === "CHAT_LOCKED") {
              lockedRef.current = true;
              setLockedChatId(chatId);
            }
          }
          return;
        }

        const json = await messagesRes.json();
        const items: ApiMessageItem[] = json.data ?? [];

        // Into this chat's own instance, unless it is generating right now (its
        // local copy is newer than what the server has stored)
        if (!isChatBusy(chatId)) {
          getChat(chatId).messages = mapApiMessagesToUIMessages(items);
        }
        if (!active) return;

        if (json.meta?.session) {
          setFetchedSessionMeta(
            mapApiSessionToDomain({ ...(json.meta.session as ApiSessionItem), messageCount: items.length })
          );
        } else {
          // Graceful fallback for endpoints without embedded session meta
          fetch(`/api/v1/chats/${chatId}`, { credentials: "same-origin" })
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

        setOlderCursor(json.meta?.nextCursor ?? null);

        // Still generating on the server (reload, other tab) and not attached here yet
        const latest = items[items.length - 1];
        if (latest?.role === "assistant" && latest.status === "streaming" && !isChatBusy(chatId)) {
          onStreamingReplyRef.current?.(chatId);
        }
      } catch {
        // Failed to load messages
      } finally {
        if (active) setIsLoadingMessages(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [currentChatId, onNotFound, reloadTick]);

  async function handleLoadOlder(options?: { limit?: number; targetMessageId?: string }) {
    if (!currentChatId || !olderCursor || isLoadingOlder) return;
    const chatId = currentChatId;

    const fetchLimit = Math.min(Math.max(1, options?.limit ?? 20), 500);
    const targetMessageId = options?.targetMessageId;
    const scroller = scrollContainerRef.current;
    const prevScrollHeight = scroller?.scrollHeight ?? 0;
    const prevScrollTop = scroller?.scrollTop ?? 0;

    try {
      setIsLoadingOlder(true);
      const res = await fetch(`/api/v1/chats/${chatId}/messages?limit=${fetchLimit}&cursor=${olderCursor}`, {
        credentials: "same-origin",
      });
      if (!res.ok) return;

      const json = await res.json();
      const items: ApiMessageItem[] = json.data ?? [];
      if (items.length === 0) {
        setOlderCursor(null);
        return;
      }

      const chat = getChat(chatId);
      const existingIds = new Set(chat.messages.map((m) => m.id));
      const olderUIMessages = mapApiMessagesToUIMessages(items).filter((m) => !existingIds.has(m.id));
      chat.messages = [...olderUIMessages, ...chat.messages];
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
