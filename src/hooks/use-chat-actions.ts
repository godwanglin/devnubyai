"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { ensureGroupExpanded } from "@/components/sidebar/sidebar";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import type { Session } from "@/types";

interface UseChatActionsOptions {
  activeChatId: string | null;
  activeSession: Session | null;
  isStreamingOrSubmitted: boolean;
  stopStream: () => Promise<void>;
  onResetActiveChat: () => void;
  setFetchedSessionMeta: Dispatch<SetStateAction<Session | null>>;
  renameSession: (chatId: string, newTitle: string) => Promise<boolean>;
  togglePinSession: (chatId: string, nextPinned: boolean) => Promise<boolean>;
  archiveSession: (chatId: string, archived: boolean) => Promise<boolean>;
  duplicateSession: (chatId: string, newTitle?: string) => Promise<Session | null>;
  deleteSession: (chatId: string) => Promise<boolean>;
  updateSessionShareToken: (chatId: string, shareToken: string | null) => void;
}

export function useChatActions({
  activeChatId,
  activeSession,
  isStreamingOrSubmitted,
  stopStream,
  onResetActiveChat,
  setFetchedSessionMeta,
  renameSession,
  togglePinSession,
  archiveSession,
  duplicateSession,
  deleteSession,
  updateSessionShareToken,
}: UseChatActionsOptions) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();

  const [renamingTarget, setRenamingTarget] = useState<{ id: string; title: string } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [deletingTarget, setDeletingTarget] = useState<{ id: string; title: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  async function handleConfirmRename(newTitle: string) {
    if (!renamingTarget) return;
    setIsRenaming(true);
    const targetId = renamingTarget.id;
    const ok = await renameSession(targetId, newTitle);
    setIsRenaming(false);
    if (ok) {
      setFetchedSessionMeta((prev) =>
        prev && prev.id === targetId ? { ...prev, title: newTitle.trim() } : prev
      );
      toast(t("toast.chatRenamed"));
      setRenamingTarget(null);
    } else {
      toast(t("toast.actionFailed"));
    }
  }

  async function handleTogglePin(chatId: string, currentlyPinned: boolean) {
    const nextPinned = !currentlyPinned;
    if (nextPinned) ensureGroupExpanded("pinned");
    const ok = await togglePinSession(chatId, nextPinned);
    if (ok) {
      setFetchedSessionMeta((prev) =>
        prev && prev.id === chatId ? { ...prev, isPinned: nextPinned } : prev
      );
      toast(nextPinned ? t("toast.chatPinned") : t("toast.chatUnpinned"));
    } else {
      toast(t("toast.actionFailed"));
    }
  }

  async function handleArchive(chatId: string, currentlyArchived: boolean) {
    const nextArchived = !currentlyArchived;
    const isTargetActive = chatId === activeChatId;

    if (nextArchived && isTargetActive && isStreamingOrSubmitted) {
      await stopStream().catch(() => {});
    }

    const ok = await archiveSession(chatId, nextArchived);
    if (!ok) {
      toast(t("toast.actionFailed"));
      return;
    }

    if (nextArchived) {
      toast(t("toast.chatArchived"));
      if (isTargetActive) {
        setIsShareModalOpen(false);
        onResetActiveChat();
        router.push("/");
      }
    } else {
      setFetchedSessionMeta((prev) =>
        prev && prev.id === chatId ? { ...prev, isArchived: false } : prev
      );
      toast(t("toast.chatUnarchived"));
    }
  }

  async function handleDuplicateActiveChat() {
    if (!activeChatId || isDuplicating) return;
    setIsDuplicating(true);
    const baseTitle = activeSession?.title || "New chat";
    const suffix = ` (${t("chatModals.copySuffix")})`;
    const copyTitle = `${baseTitle.slice(0, Math.max(1, 200 - suffix.length))}${suffix}`;

    const duplicated = await duplicateSession(activeChatId, copyTitle);
    setIsDuplicating(false);

    if (duplicated) {
      toast(t("toast.chatDuplicated"));
      router.push(`/c/${duplicated.id}`);
    } else {
      toast(t("toast.actionFailed"));
    }
  }

  async function handleConfirmDelete() {
    if (!deletingTarget) return;
    setIsDeleting(true);
    const targetId = deletingTarget.id;
    const isDeletingActive = targetId === activeChatId;

    if (isDeletingActive && isStreamingOrSubmitted) {
      await stopStream().catch(() => {});
    }

    const ok = await deleteSession(targetId);
    setIsDeleting(false);

    if (ok) {
      toast(t("toast.chatDeleted"));
      setDeletingTarget(null);
      if (isDeletingActive) {
        setIsShareModalOpen(false);
        onResetActiveChat();
        router.push("/");
      }
    } else {
      toast(t("toast.actionFailed"));
    }
  }

  function handleShareTokenChange(token: string | null) {
    if (!activeChatId) return;
    updateSessionShareToken(activeChatId, token);
    setFetchedSessionMeta((prev) =>
      prev && prev.id === activeChatId ? { ...prev, shareToken: token } : prev
    );
  }

  return {
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
  };
}
