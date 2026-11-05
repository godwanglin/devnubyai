"use client";

import { useCallback, useEffect, useState } from "react";
import {
  livePreviewItem,
  stepLiveDocument,
  type LiveDocumentEvent,
  type LiveDocumentState,
} from "@/lib/chat/live-document";
import type { Message, SessionFileItem } from "@/types";

interface UseLiveDocumentOptions {
  activeChatId: string | null;
  messages: Message[];
  streamingId: string | null;
  setFilesPanelOpen: (open: boolean) => void;
  setActivePreviewFile: (file: SessionFileItem | null) => void;
}

/**
 * Live document preview of the open chat: follows the reply's document-building tool
 * calls, takes the versions the server streams (`data-live-document`) and opens the
 * final file when the call returns. See lib/chat/live-document.ts.
 */
export function useLiveDocument({
  activeChatId,
  messages,
  streamingId,
  setFilesPanelOpen,
  setActivePreviewFile,
}: UseLiveDocumentOptions) {
  const [liveDocument, setLiveDocument] = useState<LiveDocumentState | null>(null);
  // Build calls the user closed the live view of: not reopened for that call
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  // Last document a live build finished: shown again while the AI revises it
  const [lastFinal, setLastFinal] = useState<SessionFileItem | null>(null);
  const [trackedChatId, setTrackedChatId] = useState(activeChatId);

  // Another chat opened: nothing of this one's build carries over
  if (trackedChatId !== activeChatId) {
    setTrackedChatId(activeChatId);
    setLiveDocument(null);
    setLastFinal(null);
  }

  const liveCallId = liveDocument?.toolCallId ?? null;

  // Adjusted while rendering: the messages are the source of truth
  const step = activeChatId
    ? stepLiveDocument({ current: liveDocument, messages, streamingId, chatId: activeChatId, dismissed, lastFinal })
    : null;
  if (step) {
    setLiveDocument(step.live);
    if (step.final) {
      setLastFinal(step.final);
      // A rebuilt file can keep its id: the call's id makes the URL new for every version
      const { url } = step.final;
      setActivePreviewFile({ ...step.final, url: `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(liveCallId ?? "")}` });
    }
  }

  // A new build opens the panel (the open/closed pref lives outside React)
  useEffect(() => {
    if (liveCallId) setFilesPanelOpen(true);
  }, [liveCallId, setFilesPanelOpen]);

  const dismissLiveDocument = useCallback(() => {
    if (liveCallId) setDismissed((prev) => new Set(prev).add(liveCallId));
    setLiveDocument(null);
  }, [liveCallId]);

  /** Handles a `data-live-document` part of the chat stream; false for other parts. */
  const handleLiveDocumentData = useCallback(
    (chatId: string | null, part: { type: string; data?: unknown }): boolean => {
      if (part.type !== "data-live-document" || !part.data) return false;
      if (!chatId || chatId !== activeChatId) return true;
      const event = part.data as LiveDocumentEvent;
      if (dismissed.has(event.toolCallId)) return true;
      const preview = livePreviewItem(event);
      setLiveDocument((prev) =>
        prev && prev.toolCallId === event.toolCallId
          ? { ...prev, phase: "rendering", filename: preview.displayName, preview, previewIsLive: true }
          : {
              toolCallId: event.toolCallId,
              toolName: prev?.toolName ?? "run_skill_script",
              phase: "rendering",
              filename: preview.displayName,
              source: "",
              input: undefined,
              preview,
              previewIsLive: true,
            }
      );
      setFilesPanelOpen(true);
      return true;
    },
    [activeChatId, dismissed, setFilesPanelOpen]
  );

  return { liveDocument, dismissLiveDocument, handleLiveDocumentData };
}
