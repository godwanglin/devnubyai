"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loadSessions,
  mapApiSessionToDomain,
  type ApiSessionItem,
} from "@/lib/chat/client-mappers";
import type { Session } from "@/types";

export function useChatSessions(pathname: string | null) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);

  const fetchSessions = useCallback(() => {
    loadSessions().then((items) => {
      if (items) setSessions(items);
    });
  }, []);

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

  const renameSession = useCallback(async (chatId: string, newTitle: string): Promise<boolean> => {
    const trimmed = newTitle.trim();
    if (!trimmed) return false;

    let previousTitle: string | undefined;
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === chatId) {
          previousTitle = s.title;
          return { ...s, title: trimmed };
        }
        return s;
      })
    );

    try {
      const res = await fetch(`/api/v1/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
        credentials: "same-origin",
      });

      if (!res.ok) throw new Error("Failed to rename");
      return true;
    } catch {
      if (previousTitle !== undefined) {
        setSessions((prev) =>
          prev.map((s) => (s.id === chatId ? { ...s, title: previousTitle! } : s))
        );
      }
      return false;
    }
  }, []);

  const togglePinSession = useCallback(
    async (chatId: string, nextPinned: boolean): Promise<boolean> => {
      setSessions((prev) =>
        prev.map((s) => (s.id === chatId ? { ...s, isPinned: nextPinned } : s))
      );

      try {
        const res = await fetch(`/api/v1/chats/${chatId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPinned: nextPinned }),
          credentials: "same-origin",
        });

        if (!res.ok) throw new Error("Failed to update pin");
        return true;
      } catch {
        setSessions((prev) =>
          prev.map((s) => (s.id === chatId ? { ...s, isPinned: !nextPinned } : s))
        );
        return false;
      }
    },
    []
  );

  const archiveSession = useCallback(
    async (chatId: string, archived: boolean): Promise<boolean> => {
      try {
        const res = await fetch(`/api/v1/chats/${chatId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isArchived: archived }),
          credentials: "same-origin",
        });

        if (!res.ok) return false;

        if (archived) {
          setSessions((prev) => prev.filter((s) => s.id !== chatId));
        } else {
          const json = await res.json().catch(() => null);
          if (json?.data) {
            const restored = mapApiSessionToDomain(json.data as ApiSessionItem);
            setSessions((prev) => [restored, ...prev.filter((s) => s.id !== restored.id)]);
          } else {
            loadSessions().then((items) => {
              if (items) setSessions(items);
            });
          }
        }
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  const updateSessionShareToken = useCallback(
    (chatId: string, shareToken: string | null) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === chatId ? { ...s, shareToken } : s))
      );
    },
    []
  );

  const duplicateSession = useCallback(
    async (chatId: string, newTitle?: string): Promise<Session | null> => {
      try {
        const res = await fetch(`/api/v1/chats/${chatId}/duplicate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newTitle ? { title: newTitle } : {}),
          credentials: "same-origin",
        });

        if (!res.ok) return null;
        const json = await res.json();
        const apiItem: ApiSessionItem | undefined = json?.data;
        if (!apiItem) return null;

        const mapped = mapApiSessionToDomain(apiItem);
        setSessions((prev) => [mapped, ...prev.filter((s) => s.id !== mapped.id)]);
        return mapped;
      } catch {
        return null;
      }
    },
    []
  );

  const deleteSession = useCallback(async (chatId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) return false;
      setSessions((prev) => prev.filter((s) => s.id !== chatId));
      return true;
    } catch {
      return false;
    }
  }, []);

  return {
    sessions,
    setSessions,
    isLoadingSessions,
    fetchSessions,
    renameSession,
    togglePinSession,
    archiveSession,
    updateSessionShareToken,
    duplicateSession,
    deleteSession,
  };
}
