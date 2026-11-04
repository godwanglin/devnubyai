"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { Sidebar } from "@/components/sidebar/sidebar";
import { ChatTopbar } from "./chat-topbar";
import { ChatFilesPanel } from "./chat-files-panel";
import { Composer } from "./composer";
import { MessageList } from "./message-list";
import { ChatTimeline } from "./chat-timeline";
import { SelectionAskButton } from "./selection-ask-button";
import { QuotaBanner } from "./quota-banner";
import {
  parseQuotaError,
  readableErrorMessage,
  type QuotaNotice,
} from "@/lib/chat/quota-shared";
import { MAX_QUOTES_PER_MESSAGE } from "@/lib/chat/quotes";
import { Welcome } from "./welcome";
import { ProjectHomeView } from "@/components/projects/project-home-view";
import { dispatchProjectsUpdated } from "@/hooks/use-projects";
import { ChatMessagesSkeleton } from "./chat-skeleton";
import { RenameModal } from "@/components/modals/rename-modal";
import { PinModal } from "@/components/modals/pin-modal";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { ShareChatModal } from "@/components/modals/share-chat-modal";
import { useChatSessions } from "@/hooks/use-chat-sessions";
import { useChatPrefs } from "@/hooks/use-chat-prefs";
import { useChatHistory } from "@/hooks/use-chat-history";
import { useChatActions } from "@/hooks/use-chat-actions";
import {
  mapApiSessionToDomain,
  mapUIMessagesToDomain,
  messageAttachmentsMap,
  messageQuotesMap,
  messageSourceMentionsMap,
  messageFeedbackMap,
} from "@/lib/chat/client-mappers";
import { errorMessage } from "@/lib/chat/transport";
import {
  countWorkingChats,
  disposeChat,
  getChat,
  markWorking,
  newDraftKey,
  promoteDraft,
  setChatEvents,
  setViewedChat,
  type ChatEvents,
} from "@/lib/chat/chat-registry";
import {
  OPEN_FILE_PREVIEW_EVENT,
  AI_EDIT_REQUEST_EVENT,
  AI_FILE_UPDATED_EVENT,
  ADD_EDIT_CHIP_EVENT,
  dispatchClearEditChips,
  dispatchRemoveEditChip,
  dispatchAIFileUpdated,
  withCacheBuster,
  type AIEditRequestPayload,
  type AIFileUpdatedPayload,
  type EditRequestChip,
} from "@/lib/files/preview-events";
import { useI18n } from "@/providers/i18n-provider";
import { useProjectDetail } from "@/hooks/use-project-detail";
import type { SourceMention } from "@/lib/chat/source-mentions";
import { useAccount } from "@/providers/account-provider";
import { setQuotaSnapshot, useQuota } from "@/hooks/use-quota";
import { AuthModal } from "@/components/login/auth-modal";
import {
  OnboardingFlow,
  stepFromHash as onboardingStepFromHash,
} from "@/components/onboarding/onboarding-flow";
import type { OnboardingStep } from "@/lib/onboarding/options";
import { useToast } from "@/providers/toast-provider";
import type { MessageAttachment, SessionFileItem, UserQuota } from "@/types";

/** The server's 429 for "too many replies generating at once" (see claimGenerationSlot) */
function isParallelLimitError(err: unknown): boolean {
  return err instanceof Error && /generated at once/i.test(err.message);
}

export function ChatShell() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { models, user } = useAccount();
  const router = useRouter();
  const pathname = usePathname();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isFilesFullscreen, setIsFilesFullscreen] = useState(false);
  const [activePreviewFile, setActivePreviewFile] = useState<SessionFileItem | null>(null);
  const {
    storedModelId,
    reasoningLevel,
    isFilesPanelOpen,
    setModelId,
    setReasoningLevel,
    setFilesPanelOpen: setIsFilesPanelOpen,
  } = useChatPrefs();

  // AI live edit: track file being edited for undo
  const [editTargetFileId, setEditTargetFileId] = useState<string | null>(null);
  const [pendingUndo, setPendingUndo] = useState<{ fileId: string; content: string } | null>(null);
  const [pendingFileUpdate, setPendingFileUpdate] = useState<{ fileId: string; highlightText?: string } | null>(null);

  useEffect(() => {
    const onOpenPreview = (e: Event) => {
      const detail = (e as CustomEvent<SessionFileItem>).detail;
      if (!detail) return;
      const freshUrl = detail.url ? withCacheBuster(detail.url) : detail.url;
      setActivePreviewFile({ ...detail, url: freshUrl });
      setIsFilesPanelOpen(true);
    };
    window.addEventListener(OPEN_FILE_PREVIEW_EVENT, onOpenPreview);
    return () => window.removeEventListener(OPEN_FILE_PREVIEW_EVENT, onOpenPreview);
  }, [setIsFilesPanelOpen]);

  // AI live edit: listen for edit requests from the inline toolbar in the panel
  useEffect(() => {
    function onEditRequest(e: Event) {
      const detail = (e as CustomEvent<AIEditRequestPayload>).detail;
      if (!detail || !detail.fileId) return;
      // Capture original content for undo before sending to AI
      if (detail.fileId) {
        const file = activePreviewFile;
        if (file && file.id === detail.fileId && file.url) {
          fetch(file.url, { credentials: "same-origin" })
            .then((r) => r.ok ? r.text() : null)
            .then((text) => {
              if (text) setPendingUndo({ fileId: detail.fileId, content: text });
            })
            .catch(() => {});
        }
      }
      setEditTargetFileId(detail.fileId);
      // Build user message with structured context block for AI
      const lines = [
        `[Request Edit]`,
        `FileName: ${detail.filename || "untitled"}`,
        `FileId: ${detail.fileId}`,
      ];
      if (detail.page) {
        lines.push(`Halaman: ${detail.page}`);
      }
      if (detail.lineNumber) {
        if (detail.lineEndNumber && detail.lineEndNumber !== detail.lineNumber) {
          lines.push(`Line: ${detail.lineNumber}-${detail.lineEndNumber}`);
        } else {
          lines.push(`Line: ${detail.lineNumber}`);
        }
      }
      if (detail.cellRange) {
        lines.push(`Cell/Range: ${detail.cellRange}`);
      }
      lines.push(`User Selected Text:\n"${detail.selectedText.slice(0, 2500)}"`);
      lines.push(`\nUser Instruction: ${detail.instruction}`);

      const contextBlock = lines.join("\n");
      setPendingFileUpdate({ fileId: detail.fileId, highlightText: detail.selectedText });
      handleSend(contextBlock, {});
    }
    window.addEventListener(AI_EDIT_REQUEST_EVENT, onEditRequest);
    return () => window.removeEventListener(AI_EDIT_REQUEST_EVENT, onEditRequest);
  }, [activePreviewFile, handleSend]);

  // AI live edit: listen for file-updated events (after AI writes or edits a file)
  useEffect(() => {
    function onFileUpdated(e: Event) {
      const detail = (e as CustomEvent<AIFileUpdatedPayload>).detail;
      if (!detail) return;
      if (
        activePreviewFile &&
        ((detail.fileId && activePreviewFile.id === detail.fileId) ||
          (detail.filename && activePreviewFile.filename === detail.filename))
      ) {
        setActivePreviewFile((prev) =>
          prev ? { ...prev, url: withCacheBuster(prev.url) } : prev
        );
      }
    }

    function onGeneralFilesUpdated() {
      // If a preview file is currently open and tools updated files in the background, refresh it with cache-buster
      setActivePreviewFile((prev) =>
        prev ? { ...prev, url: withCacheBuster(prev.url) } : prev
      );
    }

    window.addEventListener(AI_FILE_UPDATED_EVENT, onFileUpdated);
    window.addEventListener("devnuby:files-updated", onGeneralFilesUpdated);
    return () => {
      window.removeEventListener(AI_FILE_UPDATED_EVENT, onFileUpdated);
      window.removeEventListener("devnuby:files-updated", onGeneralFilesUpdated);
    };
  }, [activePreviewFile]);

  // AI live edit: listen for undo requests from the inline toolbar
  useEffect(() => {
    function onUndo(e: Event) {
      const detail = (e as CustomEvent<{ fileId: string }>).detail;
      if (!detail?.fileId) return;
      void handleUndoEdit(detail.fileId);
    }
    window.addEventListener("devnuby:undo-edit", onUndo);
    return () => window.removeEventListener("devnuby:undo-edit", onUndo);
  }, [handleUndoEdit]);

  // Excerpts picked with "Tanya Devnuby", attached to the next message
  const [pendingQuotes, setPendingQuotes] = useState<string[]>([]);
  function handleAddQuote(text: string) {
    setIsFilesFullscreen(false);
    setPendingQuotes((prev) => (prev.includes(text) ? prev : [...prev, text].slice(-MAX_QUOTES_PER_MESSAGE)));
  }

  // Multi-selection edit target chips picked from file previews
  const [pendingEditChips, setPendingEditChips] = useState<EditRequestChip[]>([]);

  useEffect(() => {
    function onAddEditChip(e: Event) {
      const chip = (e as CustomEvent<EditRequestChip>).detail;
      if (!chip) return;
      setPendingEditChips((prev) => {
        if (prev.some((c) => c.id === chip.id)) return prev;
        return [...prev, chip];
      });
      toast(t("chatFiles.requestEditsChipAdded", { count: pendingEditChips.length + 1 }) || "Target edit ditambahkan");
    }
    window.addEventListener(ADD_EDIT_CHIP_EVENT, onAddEditChip);
    return () => window.removeEventListener(ADD_EDIT_CHIP_EVENT, onAddEditChip);
  }, [pendingEditChips.length, t, toast]);

  const handleRemoveEditChip = useCallback((chipId: string) => {
    setPendingEditChips((prev) => prev.filter((c) => c.id !== chipId));
    dispatchRemoveEditChip(chipId);
  }, []);

  const {
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
  } = useChatSessions(pathname);

  const { currentChatId, currentProjectId, isProjectHome } = useMemo(() => {
    if (!pathname || pathname === "/") {
      return { currentChatId: null, currentProjectId: null, isProjectHome: false };
    }
    const parts = pathname.split("/");
    if (parts[1] === "c" && parts[2]) {
      return { currentChatId: parts[2], currentProjectId: null, isProjectHome: false };
    }
    if (parts[1] === "project" && parts[2] && parts[3] === "c" && parts[4]) {
      return { currentChatId: parts[4], currentProjectId: parts[2], isProjectHome: false };
    }
    if (parts[1] === "project" && parts[2]) {
      return { currentChatId: null, currentProjectId: parts[2], isProjectHome: true };
    }
    return { currentChatId: null, currentProjectId: null, isProjectHome: false };
  }, [pathname]);

  // Project sources the composer can @mention (refetched on projects-updated)
  const { project: currentProject } = useProjectDetail(currentProjectId);
  const projectSources = useMemo(
    () =>
      currentProject?.id === currentProjectId
        ? currentProject.files.map((f) => ({ id: f.id, filename: f.filename, mimeType: f.mimeType }))
        : [],
    [currentProject, currentProjectId]
  );

  const currentModelId =
    models.length === 0 || models.some((m) => m.id === storedModelId && !m.isLocked)
      ? storedModelId
      : (models.find((m) => !m.isLocked)?.id ?? models[0]?.id ?? storedModelId);

  // A session created from the home page, until the URL has moved to /c/<id>
  const [pendingChatId, setPendingChatId] = useState<string | null>(null);
  // The URL now names a chat (the new one, or another the user opened): no longer needed
  if (pendingChatId && currentChatId) setPendingChatId(null);
  const activeChatId = currentChatId || (pathname === "/" || isProjectHome ? pendingChatId : null);

  // The home page (and a project's home) types into a fresh draft; a new one after each use
  const [draftKey, setDraftKey] = useState(newDraftKey);
  const chatKey = activeChatId ?? draftKey;
  const chat = getChat(chatKey);

  // The sidebar dot of a finished reply goes away once its chat is open
  useEffect(() => {
    setViewedChat(activeChatId);
  }, [activeChatId]);

  // Quota banner: from a rejected send, or from an exhausted window in the user's quota
  const { quota, refresh: refreshQuota } = useQuota(Boolean(user));
  const [rejectedQuota, setRejectedQuota] = useState<QuotaNotice | null>(null);
  const [dismissedQuotaKey, setDismissedQuotaKey] = useState<string | null>(null);
  const accountQuota = useMemo<QuotaNotice | null>(() => {
    if (!quota) return null;
    const { monthly, weekly, fiveHour } = quota.windows;
    const exhausted = (
      [
        ["monthly_cost", monthly],
        ["weekly_cost", weekly],
        ["five_hour_cost", fiveHour],
      ] as const
    ).find(([, w]) => w.limitUsd !== null && w.usedUsd >= w.limitUsd);
    if (!exhausted) return null;
    const [kind, w] = exhausted;
    return { kind, used: w.usedUsd, limit: w.limitUsd!, resetAt: w.resetAt };
  }, [quota]);
  const quotaNotice = rejectedQuota ?? accountQuota;
  const quotaKey = quotaNotice ? `${quotaNotice.kind}:${quotaNotice.resetAt}` : null;
  const handleQuotaExpire = useCallback(() => {
    setRejectedQuota(null);
    void refreshQuota();
  }, [refreshQuota]);

  // The open chat's own Chat instance; other sessions keep streaming in theirs
  const {
    messages: uiMessages,
    setMessages: setUiMessages,
    regenerate,
    stop,
    status,
  } = useChat({ chat, throttle: 30 });

  // Events of every session's Chat (see chat-registry), routed by the chat they belong to
  const activeChatIdRef = useRef(activeChatId);
  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  });
  const chatEventsRef = useRef<ChatEvents>({});
  chatEventsRef.current = {
    // The server charges spend while the reply streams and pushes the new quota
    onData: (_chatId, part) => {
      if (part.type === "data-quota" && part.data) setQuotaSnapshot(part.data as UserQuota);
    },
    onError: (chatId, err) => {
      const quota = parseQuotaError(err);
      if (quota) {
        setRejectedQuota(quota);
        setDismissedQuotaKey(null);
        return;
      }
      if (isParallelLimitError(err)) {
        const max = maxParallel ?? Number(/max (\d+)/.exec(err.message)?.[1] ?? 1);
        toast(t("chatSession.parallelLimit", { max }));
        return;
      }
      // A background chat failing doesn't interrupt what the user is reading
      if (chatId === activeChatIdRef.current || !chatId) {
        toast(readableErrorMessage(err, "Failed to process message"));
      }
    },
    onFinish: (chatId, { messages, isError }) => {
      fetchSessions();
      // Keeps sidebar usage current and surfaces the banner once the quota runs out
      void refreshQuota();
      // Auto-title only after the very first turn of a chat
      const isFirstTurn = messages.filter((m) => m.role === "user").length === 1;
      if (chatId && isFirstTurn && !isError) {
        fetch(`/api/v1/chats/${chatId}/auto-title`, {
          method: "POST",
          credentials: "same-origin",
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.data?.title) {
              const newTitle: string = data.data.title;
              setSessions((prev) => prev.map((s) => (s.id === chatId ? { ...s, title: newTitle } : s)));
            }
          })
          .catch(() => {});
      }
      // AI live edit: refresh + highlight the panel, only for the chat it belongs to
      if (chatId === activeChatIdRef.current && editTargetFileId && pendingFileUpdate) {
        dispatchAIFileUpdated({
          fileId: editTargetFileId,
          filename: activePreviewFile?.filename ?? "",
          reason: "ai-edit",
          highlightTarget: pendingFileUpdate.highlightText
            ? { text: pendingFileUpdate.highlightText }
            : undefined,
        });
        setPendingFileUpdate(null);
        setEditTargetFileId(null);
      }
    },
  };
  useEffect(() => {
    setChatEvents({
      onData: (...args) => chatEventsRef.current.onData?.(...args),
      onError: (...args) => chatEventsRef.current.onError?.(...args),
      onFinish: (...args) => chatEventsRef.current.onFinish?.(...args),
    });
  }, []);

  // Generation slots of the user's plan (Free 1, Pro 3, Max 6), counted in this tab
  // (unknown on an older cached /me: then only the server's check applies)
  const maxParallel = user?.maxParallelRequests;
  function reachedParallelLimit(): boolean {
    if (!maxParallel || countWorkingChats() < maxParallel) return false;
    toast(t("chatSession.parallelLimit", { max: maxParallel }));
    return true;
  }

  const handleNotFound = useCallback(() => router.push("/"), [router]);

  // A reply interrupted by a reload keeps generating on the server; reattach to it
  function handleStreamingReply(chatId: string) {
    markWorking(chatId);
    getChat(chatId).resumeStream({ body: { chatId } }).catch(() => {});
  }

  const {
    isChatLocked,
    retryAfterUnlock,
    cancelUnlock,
    isLoadingMessages,
    olderCursor,
    isLoadingOlder,
    fetchedSessionMeta,
    setFetchedSessionMeta,
    scrollContainerRef,
    handleLoadOlder,
  } = useChatHistory({
    currentChatId,
    onNotFound: handleNotFound,
    onStreamingReply: handleStreamingReply,
  });

  // Excerpts belong to the chat they were picked from
  const [quotesChatId, setQuotesChatId] = useState(currentChatId);
  if (quotesChatId !== currentChatId) {
    setQuotesChatId(currentChatId);
    setPendingQuotes([]);
    setPendingEditChips([]);
    dispatchClearEditChips();
    setActivePreviewFile(null);
    setIsFilesFullscreen(false);
    // The open/closed pref is left alone: without an active chat the panel is
    // hidden anyway (showFilesPanel), and it comes back on the next chat.
  }

  const isStreamingOrSubmitted = status === "submitted" || status === "streaming";
  const streamingId = useMemo(() => {
    if (!isStreamingOrSubmitted) return null;
    const lastMsg = uiMessages[uiMessages.length - 1];
    return lastMsg?.role === "assistant" ? lastMsg.id : null;
  }, [isStreamingOrSubmitted, uiMessages]);

  const isThinking = status === "submitted";

  const activeSession = useMemo(() => {
    if (!activeChatId) return null;
    const fromList = sessions.find((s) => s.id === activeChatId || s.slug === activeChatId);
    if (fromList) return fromList;
    if (fetchedSessionMeta && fetchedSessionMeta.id === activeChatId) {
      return fetchedSessionMeta;
    }
    return null;
  }, [activeChatId, sessions, fetchedSessionMeta]);

  const {
    renamingTarget,
    setRenamingTarget,
    isRenaming,
    deletingTarget,
    setDeletingTarget,
    isDeleting,
    isDuplicating,
    isShareModalOpen,
    setIsShareModalOpen,
    handleConfirmRename,
    handleTogglePin,
    handleArchive,
    handleDuplicateActiveChat,
    handleConfirmDelete,
    handleShareTokenChange,
  } = useChatActions({
    activeChatId,
    activeSession,
    isStreamingOrSubmitted,
    stopStream: stop,
    onResetActiveChat: () => {
      setIsFilesFullscreen(false);
      if (activeChatId) disposeChat(activeChatId);
      setPendingChatId(null);
      setFetchedSessionMeta(null);
    },
    setFetchedSessionMeta,
    renameSession,
    togglePinSession,
    archiveSession,
    duplicateSession,
    // A deleted chat that isn't open may still be generating in the background: drop it
    deleteSession: async (chatId) => {
      const ok = await deleteSession(chatId);
      if (ok && chatId !== activeChatId) disposeChat(chatId);
      return ok;
    },
    updateSessionShareToken,
  });

  const currentTitle = activeSession?.title || t("welcome.title");

  // Share modal target: the open chat, or one picked from the sidebar menu
  const [shareTargetId, setShareTargetId] = useState<string | null>(null);
  const shareChatId = shareTargetId ?? activeChatId;
  const shareSession =
    shareChatId === activeChatId ? activeSession : (sessions.find((s) => s.id === shareChatId) ?? null);

  async function handleSend(
    text: string,
    options?: {
      webSearch?: boolean;
      extendedThinking?: boolean;
      fileIds?: string[];
      attachments?: MessageAttachment[];
      filesToUpload?: { file: File; name: string; localPreviewUrl?: string }[];
      quotes?: string[];
      editChips?: EditRequestChip[];
      sourceMentions?: SourceMention[];
    }
  ) {
    // Guests may type on the home page; login keeps the draft and sends it after
    if (!user && !currentChatId) {
      const draft = text.trim();
      if (!draft) return;
      const next = `/?prompt=${encodeURIComponent(draft.slice(0, 4000))}`;
      const params = new URLSearchParams(window.location.search);
      params.set("next", next);
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}#/authenticate`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      return;
    }

    // Quick prompts bypass the composer, so the quota block is enforced here too
    if (quotaNotice) {
      setDismissedQuotaKey(null);
      return;
    }

    const activeChips = options?.editChips ?? pendingEditChips;
    let textToSend = text;

    if (activeChips.length > 0) {
      const chipBlocks = activeChips.map((chip, idx) => {
        const lines = [
          `[Target #${idx + 1}]`,
          `FileName: ${chip.filename || "untitled"}`,
          `FileId: ${chip.fileId}`,
        ];
        if (chip.page) lines.push(`Halaman: ${chip.page}`);
        if (chip.lineNumber) {
          if (chip.lineEndNumber && chip.lineEndNumber !== chip.lineNumber) {
            lines.push(`Line: ${chip.lineNumber}-${chip.lineEndNumber}`);
          } else {
            lines.push(`Line: ${chip.lineNumber}`);
          }
        }
        if (chip.cellRange) lines.push(`Cell/Range: ${chip.cellRange}`);
        if (chip.tagName) lines.push(`Element: <${chip.tagName}>`);
        lines.push(`User Selected Text:\n"${chip.selectedText.slice(0, 2500)}"`);
        if (chip.instruction) lines.push(`Instruction: ${chip.instruction}`);
        return lines.join("\n");
      });

      const header = `[Request Edit - ${activeChips.length} Target${activeChips.length > 1 ? "s" : ""}]`;
      const userPrompt = text.trim() ? `\nUser Overall Instruction: ${text.trim()}` : "";
      textToSend = `${header}\n\n${chipBlocks.join("\n\n---\n\n")}${userPrompt}`;

      setEditTargetFileId(activeChips[0].fileId);
      setPendingFileUpdate({
        fileId: activeChips[0].fileId,
        highlightText: activeChips[0].selectedText,
      });

      setPendingEditChips([]);
      dispatchClearEditChips();
    }

    // The chat this message belongs to, fixed now: the user may open another chat (or
    // start a new one) while the session is created or files upload, and the reply
    // must still land here
    const sendChat = chat;
    const sendDraftKey = activeChatId ? null : chatKey;
    let targetChatId = activeChatId;

    // Plan limit on replies generating at once (the server enforces it too)
    if (reachedParallelLimit()) return;

    try {
      if (!targetChatId) {
        const createRes = await fetch("/api/v1/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: text.slice(0, 40).trim() || options?.filesToUpload?.[0]?.name || "New chat",
            model: currentModelId || undefined,
            projectId: currentProjectId || undefined,
          }),
          credentials: "same-origin",
        });

        if (!createRes.ok) {
          const errJson = await createRes.json().catch(() => ({}));
          throw new Error(errJson?.error?.message || "Failed to create chat session");
        }

        const createData = await createRes.json();
        const createdSession = mapApiSessionToDomain(createData.data);
        const newChatId = createdSession.id;
        targetChatId = newChatId;

        // The draft becomes this session's Chat; home gets a fresh draft next time
        if (sendDraftKey) promoteDraft(sendDraftKey, newChatId);
        const stillHere = activeChatIdRef.current === null;
        flushSync(() => {
          setSessions((prev) => [createdSession, ...prev.filter((s) => s.id !== newChatId)]);
          setDraftKey(newDraftKey());
          // Only follow the new chat if the user is still on the page it was started from
          if (stillHere) setPendingChatId(newChatId);
        });

        if (currentProjectId) dispatchProjectsUpdated();
        if (stillHere) {
          router.replace(currentProjectId ? `/project/${currentProjectId}/c/${newChatId}` : `/c/${newChatId}`);
        }
        fetchSessions();
      }

      // If there are files pending upload (e.g. from home page), upload them now
      const finalAttachments: MessageAttachment[] = [...(options?.attachments || [])];
      const finalFileIds: string[] = [...(options?.fileIds || [])];

      if (options?.filesToUpload && options.filesToUpload.length > 0) {
        for (const item of options.filesToUpload) {
          try {
            const formData = new FormData();
            formData.append("file", item.file, item.name);

            const uploadRes = await fetch(`/api/v1/chats/${targetChatId}/files`, {
              method: "POST",
              body: formData,
              credentials: "same-origin",
            });

            if (!uploadRes.ok) {
              const errJson = await uploadRes.json().catch(() => ({}));
              throw new Error(errJson?.error?.message || "Upload failed");
            }

            const json = await uploadRes.json();
            const uploaded: MessageAttachment = {
              id: json.data.id,
              filename: json.data.filename,
              displayName: json.data.displayName || item.name,
              mimeType: json.data.mimeType,
              sizeBytes: json.data.sizeBytes,
              isImage: json.data.isImage,
              url: json.data.url,
              localPreviewUrl: item.localPreviewUrl,
            };
            finalAttachments.push(uploaded);
            finalFileIds.push(uploaded.id);
          } catch (uploadErr) {
            toast(errorMessage(uploadErr, `Failed to upload ${item.name}`));
            return;
          }
        }
        window.dispatchEvent(new CustomEvent("devnuby:files-updated"));
      }

      setPendingQuotes([]);

      const optimisticMessageId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      if (finalAttachments.length) {
        messageAttachmentsMap.set(optimisticMessageId, finalAttachments);
      }
      if (options?.quotes?.length) {
        messageQuotesMap.set(optimisticMessageId, options.quotes);
      }
      if (options?.sourceMentions?.length) {
        messageSourceMentionsMap.set(optimisticMessageId, options.sourceMentions);
      }

      markWorking(targetChatId);
      await sendChat.sendMessage(
        {
          id: optimisticMessageId,
          role: "user",
          parts: [{ type: "text", text: textToSend }],
          metadata: {
            attachments: finalAttachments.length ? finalAttachments : undefined,
            quotes: options?.quotes,
            sourceMentions: options?.sourceMentions,
          },
        } as never,
        {
          body: {
            chatId: targetChatId,
            model: currentModelId || undefined,
            reasoningLevel: options?.extendedThinking ? "4" : reasoningLevel || undefined,
            webSearch: options?.webSearch || undefined,
            extendedThinking: options?.extendedThinking || undefined,
            fileIds: finalFileIds.length ? finalFileIds : undefined,
            quotes: options?.quotes?.length ? options.quotes : undefined,
            sourceIds: options?.sourceMentions?.length
              ? options.sourceMentions.map((m) => m.id)
              : undefined,
            _attachments: finalAttachments.length ? finalAttachments : undefined,
          },
        }
      );
    } catch (err) {
      toast(errorMessage(err, "Failed to process message"));
    }
  }

  // After login, a guest draft comes back as `/?prompt=` and is sent once
  const [authOpen, setAuthOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep | null>(null);
  useEffect(() => {
    const sync = () => {
      setAuthOpen(window.location.hash.startsWith("#/authenticate"));
      setOnboardingStep(onboardingStepFromHash(window.location.hash));
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // A signed-in user who hasn't onboarded yet (new signup, Google or email) starts it here
  const needsOnboarding = Boolean(user) && user?.onboarded === false;
  useEffect(() => {
    if (!needsOnboarding || window.location.hash.startsWith("#/onboarding/")) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/onboarding/name`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, [needsOnboarding]);

  const pendingPromptSent = useRef(false);
  useEffect(() => {
    // A guest draft waits until onboarding is done, then goes out
    if (!user || needsOnboarding || pendingPromptSent.current || pathname !== "/") return;
    const params = new URLSearchParams(window.location.search);
    const draft = params.get("prompt")?.trim();
    if (!draft) return;
    pendingPromptSent.current = true;
    params.delete("prompt");
    const rest = params.toString();
    window.history.replaceState(null, "", rest ? `/?${rest}` : "/");
    void handleSend(draft);
    // handleSend is recreated each render; the ref makes this fire only once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, needsOnboarding, pathname]);

  async function handleEditSubmit(messageId: string, content: string) {
    if (!activeChatId) return;
    // Check before the PATCH truncates history, or the edit would lose replies with nothing regenerated
    if (quotaNotice) {
      setDismissedQuotaKey(null);
      throw new Error(t("quota.monthlyTitle"));
    }
    const response = await fetch(`/api/v1/chats/${activeChatId}/messages/${messageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ content, truncateAfter: true }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error?.message || "Failed to edit message");
    }
    setUiMessages((prev) => {
      const index = prev.findIndex((message) => message.id === messageId);
      if (index < 0) return prev;
      return prev.slice(0, index + 1).map((message) =>
        message.id === messageId ? { ...message, parts: [{ type: "text", text: content }], content } : message
      );
    });
    await handleSend(content);
  }

  async function handleStop() {
    const chatId = activeChatId;
    const lastMsg = uiMessages[uiMessages.length - 1];
    if (chatId && lastMsg && lastMsg.role === "assistant") {
      fetch(`/api/v1/chats/${chatId}/messages/${lastMsg.id}/stop`, {
        method: "POST",
        credentials: "same-origin",
      }).catch(() => {});
    }
    await stop();
  }

  async function handleRegenerate(messageId: string) {
    if (!activeChatId) return;
    if (quotaNotice) {
      setDismissedQuotaKey(null);
      return;
    }
    if (reachedParallelLimit()) return;
    messageFeedbackMap.delete(messageId);
    markWorking(activeChatId);
    try {
      await regenerate({
        messageId,
        body: {
          chatId: activeChatId,
          model: currentModelId || undefined,
          reasoningLevel: reasoningLevel || undefined,
        },
      });
    } catch (err) {
      toast(errorMessage(err, "Failed to regenerate"));
    }
  }

  /** AI live edit: restore the file to its pre-edit content */
  async function handleUndoEdit(fileId: string) {
    if (!activeChatId) return;
    const snapshot = pendingUndo;
    if (!snapshot || snapshot.fileId !== fileId) return;
    try {
      const res = await fetch(`/api/v1/chats/${activeChatId}/files/${fileId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ content: snapshot.content, reason: "undo" }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error?.message || "Failed to undo edit");
      }
      // Refresh panel + clear undo state
      if (activePreviewFile && activePreviewFile.id === fileId) {
        setActivePreviewFile((prev) => (prev ? { ...prev, url: withCacheBuster(prev.url) } : prev));
      }
      window.dispatchEvent(new CustomEvent("devnuby:files-updated"));
      setPendingUndo(null);
      toast(t("chatFiles.undoDone"));
    } catch (err) {
      toast(errorMessage(err, "Failed to undo edit"));
    }
  }

  const domainMessages = useMemo(() => mapUIMessagesToDomain(uiMessages), [uiMessages]);
  const showFilesPanel = isFilesPanelOpen && Boolean(activeChatId);
  const hideChatForFullscreenFiles = showFilesPanel && isFilesFullscreen;

  const closeFilesPanel = useCallback(() => {
    setIsFilesPanelOpen(false);
    setIsFilesFullscreen(false);
    setActivePreviewFile(null);
  }, [setIsFilesPanelOpen]);

  const toggleFilesPanel = useCallback(() => {
    if (isFilesPanelOpen) closeFilesPanel();
    else setIsFilesPanelOpen(true);
  }, [isFilesPanelOpen, closeFilesPanel, setIsFilesPanelOpen]);

  // Ctrl+Shift+B (Cmd+Shift+B on macOS) toggles the right files panel.
  // preventDefault stops the browser's own bookmarks-bar toggle.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      if (e.code !== "KeyB" || e.repeat) return;
      if (!activeChatId) return;
      e.preventDefault();
      toggleFilesPanel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeChatId, toggleFilesPanel]);

  function handleToggleSidebar() {
    if (typeof window !== "undefined" && window.innerWidth <= 768) {
      setMobileOpen(true);
    } else {
      setIsCollapsed((v) => !v);
    }
  }

  const renderComposer = (customPlaceholder?: string) => (
    <Composer
      placeholder={customPlaceholder}
      sources={projectSources}
      notice={
        quotaNotice && quotaKey !== dismissedQuotaKey ? (
          <QuotaBanner
            key={quotaKey}
            notice={quotaNotice}
            onDismiss={() => setDismissedQuotaKey(quotaKey)}
            onExpire={handleQuotaExpire}
          />
        ) : null
      }
      sendBlocked={Boolean(quotaNotice)}
      quotes={pendingQuotes}
      onRemoveQuote={(index) =>
        setPendingQuotes((prev) => prev.filter((_, i) => i !== index))
      }
      editChips={pendingEditChips}
      onRemoveEditChip={handleRemoveEditChip}
      chatId={activeChatId}
      canSend={() => !reachedParallelLimit()}
      onSend={handleSend}
      onStop={handleStop}
      disabled={isStreamingOrSubmitted}
      currentModelId={currentModelId}
      onModelChange={setModelId}
      reasoningLevel={reasoningLevel}
      onReasoningChange={setReasoningLevel}
    />
  );

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[var(--surface)]">
      <AuthModal isOpen={authOpen && !user} onClose={() => setAuthOpen(false)} />
      {user && onboardingStep && (
        <OnboardingFlow step={onboardingStep} onFinished={() => setOnboardingStep(null)} />
      )}
      <Sidebar
        sessions={sessions}
        isLoadingSessions={isLoadingSessions}
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed((v) => !v)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onRenameSession={(s) => setRenamingTarget({ id: s.id, title: s.title })}
        onTogglePinSession={(s) => handleTogglePin(s.id, Boolean(s.isPinned))}
        onArchiveSession={(s) => handleArchive(s.id, Boolean(s.isArchived))}
        onDeleteSession={(s) => setDeletingTarget({ id: s.id, title: s.title })}
        onShareSession={(s) => {
          // Shares that chat without switching to it
          setShareTargetId(s.id);
          setIsShareModalOpen(true);
        }}
      />

      <main
        className={
          hideChatForFullscreenFiles
            ? "hidden"
            : "relative flex flex-col min-w-0 flex-1 grid-rows-[auto_1fr_auto]"
        }
      >
        {isProjectHome ? (
          <ProjectHomeView
            projectId={currentProjectId!}
            composer={(projectName) =>
              renderComposer(t("projects.newChatPlaceholder", { name: projectName }))
            }
          />
        ) : (
          <>
            <ChatTopbar
              title={currentTitle}
              projectId={currentProjectId}
              isLoading={isLoadingMessages}
              hasActiveChat={Boolean(activeChatId)}
              isPinned={Boolean(activeSession?.isPinned)}
              isArchived={Boolean(activeSession?.isArchived)}
              isShared={Boolean(activeSession?.shareToken)}
              isFilesOpen={showFilesPanel}
              isDuplicating={isDuplicating}
              onToggleSidebar={handleToggleSidebar}
              onShare={() => {
                if (activeChatId) {
                  setIsShareModalOpen(true);
                } else {
                  toast(t("shareModal.startChatFirst"));
                }
              }}
              onRename={() => {
                if (activeChatId) {
                  setRenamingTarget({
                    id: activeChatId,
                    title: activeSession?.title || "New chat",
                  });
                }
              }}
              onTogglePin={() => {
                if (activeChatId) {
                  handleTogglePin(activeChatId, Boolean(activeSession?.isPinned));
                }
              }}
              onDuplicate={handleDuplicateActiveChat}
              onViewFiles={toggleFilesPanel}
              onArchive={() => {
                if (activeChatId) {
                  handleArchive(activeChatId, Boolean(activeSession?.isArchived));
                }
              }}
              onDelete={() => {
                if (activeChatId) {
                  setDeletingTarget({
                    id: activeChatId,
                    title: activeSession?.title || "New chat",
                  });
                }
              }}
            />

            {/* Nothing to navigate on home (no chat yet) */}
            {activeChatId ? (
              <ChatTimeline
                chatId={activeChatId}
                messages={domainMessages}
                scrollContainerRef={scrollContainerRef}
                onLoadOlder={handleLoadOlder}
                hasOlderMessages={Boolean(olderCursor)}
                isLoadingOlder={isLoadingOlder}
              />
            ) : null}

            <div ref={scrollContainerRef} data-ask-selectable="true" className="flex-1 overflow-y-auto overflow-x-hidden">
              {isLoadingMessages ? (
                <ChatMessagesSkeleton />
              ) : domainMessages.length === 0 && !isThinking ? (
                <Welcome onSelectPrompt={handleSend} />
              ) : (
                <MessageList
                  messages={domainMessages}
                  chatId={activeChatId ?? undefined}
                  isThinking={isThinking}
                  streamingId={streamingId}
                  onRegenerate={handleRegenerate}
                  onEditSubmit={handleEditSubmit}
                  onLoadOlder={handleLoadOlder}
                  hasOlderMessages={Boolean(olderCursor)}
                  isLoadingOlder={isLoadingOlder}
                />
              )}
            </div>

            {renderComposer()}
          </>
        )}
      </main>

      <SelectionAskButton
        containerRef={scrollContainerRef}
        enabled={domainMessages.length > 0 || showFilesPanel}
        onAsk={handleAddQuote}
      />


      <ChatFilesPanel
        isOpen={showFilesPanel}
        chatId={activeChatId}
        activeFile={activePreviewFile}
        onSelectFile={setActivePreviewFile}
        isFullscreen={isFilesFullscreen}
        showSidebarToggle={isCollapsed}
        onToggleFullscreen={() => setIsFilesFullscreen((v) => !v)}
        onToggleSidebar={handleToggleSidebar}
        onClose={closeFilesPanel}
      />

      {/* The server refuses PIN-locked chats until the PIN is entered */}
      <PinModal isOpen={isChatLocked} mode="verify" onClose={cancelUnlock} onSuccess={retryAfterUnlock} />

      <RenameModal
        isOpen={Boolean(renamingTarget)}
        onClose={() => setRenamingTarget(null)}
        onSubmit={handleConfirmRename}
        initialValue={renamingTarget?.title ?? ""}
        title={t("chatModals.renameTitle")}
        description={t("chatModals.renameDescription")}
        placeholder={t("chatModals.renamePlaceholder")}
        submitLabel={isRenaming ? t("chatModals.saving") : t("chatModals.save")}
        cancelLabel={t("chatModals.cancel")}
        loading={isRenaming}
      />

      <ConfirmModal
        isOpen={Boolean(deletingTarget)}
        onClose={() => setDeletingTarget(null)}
        onConfirm={handleConfirmDelete}
        title={t("chatModals.deleteTitle")}
        description={t("chatModals.deleteDescription", {
          title: deletingTarget?.title ?? "",
        })}
        confirmLabel={isDeleting ? t("chatModals.deleting") : t("chatModals.deleteConfirm")}
        cancelLabel={t("chatModals.cancel")}
        variant="danger"
        loading={isDeleting}
      />

      <ShareChatModal
        isOpen={isShareModalOpen && Boolean(shareChatId)}
        onClose={() => {
          setIsShareModalOpen(false);
          setShareTargetId(null);
        }}
        chatId={shareChatId}
        shareToken={shareSession?.shareToken ?? null}
        onShareTokenChange={(token) => {
          if (!shareChatId || shareChatId === activeChatId) {
            handleShareTokenChange(token);
          } else {
            updateSessionShareToken(shareChatId, token);
          }
        }}
      />
    </div>
  );
}
