"use client";

import React from "react";
import { CreateProjectModal } from "@/components/modals/create-project-modal";
import { DeleteProjectModal } from "@/components/modals/delete-project-modal";
import { RenameModal } from "@/components/modals/rename-modal";
import { ShareProjectModal } from "@/components/modals/share-project-modal";
import { ConfirmLockChatModal } from "@/components/modals/confirm-lock-chat-modal";
import { PinModal } from "@/components/modals/pin-modal";
import { useI18n } from "@/providers/i18n-provider";
import type { ProjectDto } from "@/lib/projects/types";

export interface SidebarModalsProps {
  isCreateProjectOpen: boolean;
  onCloseCreateProject: () => void;
  onCreateProjectSubmit: (name: string) => Promise<boolean | void>;

  projectToRename: ProjectDto | null;
  onCloseRenameProject: () => void;
  onConfirmRenameProject: (newName: string) => Promise<void>;

  projectToDelete: ProjectDto | null;
  onCloseDeleteProject: () => void;
  onConfirmDeleteProject: (cascade: boolean) => Promise<void>;

  projectToShare: ProjectDto | null;
  onCloseShareProject: () => void;

  chatToLock: string | null;
  onCloseConfirmLockChat: () => void;
  onConfirmLockChat: () => void;

  isPinModalOpen: boolean;
  pinModalMode: "create" | "verify";
  onClosePinModal: () => void;
  onPinSuccess: (pin: string) => void;
}

export function SidebarModals({
  isCreateProjectOpen,
  onCloseCreateProject,
  onCreateProjectSubmit,
  projectToRename,
  onCloseRenameProject,
  onConfirmRenameProject,
  projectToDelete,
  onCloseDeleteProject,
  onConfirmDeleteProject,
  projectToShare,
  onCloseShareProject,
  chatToLock,
  onCloseConfirmLockChat,
  onConfirmLockChat,
  isPinModalOpen,
  pinModalMode,
  onClosePinModal,
  onPinSuccess,
}: SidebarModalsProps) {
  const { t } = useI18n();

  return (
    <>
      <CreateProjectModal
        isOpen={isCreateProjectOpen}
        onClose={onCloseCreateProject}
        onSubmit={onCreateProjectSubmit}
      />

      <RenameModal
        isOpen={Boolean(projectToRename)}
        onClose={onCloseRenameProject}
        onSubmit={onConfirmRenameProject}
        initialValue={projectToRename?.name ?? ""}
        title={t("projects.renameProject")}
        submitLabel={t("chatModals.save")}
        cancelLabel={t("chatModals.cancel")}
      />

      {projectToDelete && (
        <DeleteProjectModal
          isOpen={Boolean(projectToDelete)}
          projectName={projectToDelete.name}
          onClose={onCloseDeleteProject}
          onConfirm={onConfirmDeleteProject}
        />
      )}

      {projectToShare && (
        <ShareProjectModal
          isOpen={Boolean(projectToShare)}
          onClose={onCloseShareProject}
          project={projectToShare}
        />
      )}

      <ConfirmLockChatModal
        isOpen={Boolean(chatToLock)}
        onClose={onCloseConfirmLockChat}
        onConfirm={onConfirmLockChat}
      />

      <PinModal
        isOpen={isPinModalOpen}
        mode={pinModalMode}
        onClose={onClosePinModal}
        onSuccess={onPinSuccess}
      />
    </>
  );
}
