"use client";

import React, { useState } from "react";
import { useProjectDetail } from "@/hooks/use-project-detail";
import { ProjectHeader } from "./project-header";
import { ProjectTabs, type ProjectTabKey } from "./project-tabs";
import { ProjectChatsList } from "./project-chats-list";
import { ProjectSourcesList } from "./project-sources-list";
import { RenameModal } from "@/components/modals/rename-modal";
import { DeleteProjectModal } from "@/components/modals/delete-project-modal";
import { ShareProjectModal } from "@/components/modals/share-project-modal";
import { AddProjectSourceModal } from "@/components/modals/add-project-source-modal";
import { useProjects } from "@/hooks/use-projects";
import { useRouter } from "next/navigation";
import { useI18n } from "@/providers/i18n-provider";

export interface ProjectHomeViewProps {
  projectId: string;
  composer?: React.ReactNode | ((projectName: string) => React.ReactNode);
}

export function ProjectHomeView({ projectId, composer }: ProjectHomeViewProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { project, isLoading, error, refresh } = useProjectDetail(projectId);
  const { renameProject, togglePinProject, deleteProject } = useProjects();

  const [activeTab, setActiveTab] = useState<ProjectTabKey>("chats");
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isAddSourceOpen, setIsAddSourceOpen] = useState(false);

  if (isLoading && !project) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="w-full max-w-4xl mx-auto space-y-6 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="h-8 w-48 rounded bg-[var(--hover)]" />
            <div className="h-8 w-24 rounded bg-[var(--hover)]" />
          </div>
          <div className="h-28 w-full rounded-[14px] bg-[var(--hover)]" />
          <div className="h-8 w-36 rounded bg-[var(--hover)]" />
          <div className="space-y-3">
            <div className="h-14 w-full rounded-[10px] bg-[var(--hover)]" />
            <div className="h-14 w-full rounded-[10px] bg-[var(--hover)]" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
        <p className="text-sm font-semibold text-[var(--ink)]">
          {error || "Proyek tidak ditemukan"}
        </p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="text-xs text-[var(--accent)] hover:underline"
        >
          Kembali ke Beranda
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col min-h-0">
      {/* Top Header: [Folder] Test Proyek + Bagikan + (...) */}
      <ProjectHeader
        project={project}
        onShare={() => setIsShareOpen(true)}
        onRename={() => setIsRenameOpen(true)}
        onTogglePin={() => togglePinProject(project.id, !project.isPinned)}
        onDelete={() => setIsDeleteOpen(true)}
      />

      <div className="w-full max-w-4xl mx-auto px-6 md:px-12 pb-12 space-y-6 flex-1">
        {/* Center Composer (Gambar 2 Batch 2) */}
        {composer && (
          <div className="w-full">
            {typeof composer === "function" ? composer(project.name) : composer}
          </div>
        )}

        {/* Navigation Tabs: [Obrolan] | [Sumber] */}
        <div className="space-y-4 pt-2">
          <ProjectTabs
            activeTab={activeTab}
            onChangeTab={setActiveTab}
            chatCount={project.chats.length}
            sourceCount={project.files.length}
          />

          {/* Tab Content */}
          {activeTab === "chats" ? (
            <ProjectChatsList projectId={project.id} chats={project.chats} />
          ) : (
            <ProjectSourcesList
              projectId={project.id}
              files={project.files}
              onAddSource={() => setIsAddSourceOpen(true)}
            />
          )}
        </div>
      </div>

      {/* Rename Modal */}
      <RenameModal
        isOpen={isRenameOpen}
        onClose={() => setIsRenameOpen(false)}
        onSubmit={async (newName) => {
          const ok = await renameProject(project.id, newName);
          if (ok) {
            setIsRenameOpen(false);
            refresh();
          }
        }}
        initialValue={project.name}
        title={t("projects.renameProject")}
        submitLabel={t("chatModals.save")}
        cancelLabel={t("chatModals.cancel")}
      />

      {/* Delete Modal */}
      <DeleteProjectModal
        isOpen={isDeleteOpen}
        projectName={project.name}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={async (cascade) => {
          const ok = await deleteProject(project.id, cascade);
          if (ok) {
            router.push("/");
          }
        }}
      />
      {/* Share Project Modal */}
      <ShareProjectModal
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        project={project}
        onProjectUpdated={() => refresh()}
      />

      {/* Add Source Modal */}
      <AddProjectSourceModal
        isOpen={isAddSourceOpen}
        onClose={() => setIsAddSourceOpen(false)}
        projectId={project.id}
        onSuccess={() => refresh()}
      />
    </div>
  );
}
