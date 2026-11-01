"use client";

import React, { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";
import { ProjectItem } from "./project-item";
import type { ProjectDto } from "@/lib/projects/types";

export interface ProjectGroupProps {
  projects: ProjectDto[];
  isLoading?: boolean;
  onNavigate: () => void;
  onCreateProject: () => void;
  onRenameProject: (project: ProjectDto) => void;
  onTogglePinProject: (project: ProjectDto) => void;
  onDeleteProject: (project: ProjectDto) => void;
  onShareProject?: (project: ProjectDto) => void;
  onRenameChat?: (chatId: string, currentTitle: string) => void;
  onTogglePinChat?: (chatId: string, nextPinned: boolean) => void;
  onShareChat?: (chatId: string) => void;
  onArchiveChat?: (chatId: string) => void;
  onDeleteChat?: (chatId: string, title: string) => void;
  onMoveChatToProject?: (chatId: string, targetProjectId: string | null) => void;
  onCreateNewProjectForChat?: (chatId: string) => void;
  onLockChat?: (chatId: string, nextLocked: boolean) => void;
}

export function ProjectGroup({
  projects,
  isLoading = false,
  onNavigate,
  onCreateProject,
  onRenameProject,
  onTogglePinProject,
  onDeleteProject,
  onShareProject,
  onRenameChat,
  onTogglePinChat,
  onShareChat,
  onArchiveChat,
  onDeleteChat,
  onMoveChatToProject,
  onCreateNewProjectForChat,
  onLockChat,
}: ProjectGroupProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="space-y-1">
      {/* Header Row: "Proyek ˅" with hover action "+" */}
      <div className="group flex items-center justify-between w-full px-1.5 py-1 rounded-[6px] hover:bg-[var(--hover)]/60 transition-colors select-none">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          className="flex items-center gap-1.5 min-w-0 text-[11px] font-semibold text-[var(--placeholder)] group-hover:text-[var(--ink)] transition-colors cursor-pointer"
        >
          <span>{t("projects.title")}</span>
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 text-[var(--placeholder)] group-hover:text-[var(--ink)] transition-transform duration-200",
              !isOpen && "-rotate-90"
            )}
          />
        </button>

        {/* Hover Action: "+" */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100 transition-opacity duration-150">
          <Tooltip content={t("projects.createProject")} side="top" align="end">
            <button
              type="button"
              onClick={onCreateProject}
              className="grid place-items-center w-6 h-6 rounded-[6px] text-[var(--muted)] hover:bg-[var(--panel-elevated)] hover:text-[var(--ink)] transition-colors cursor-pointer"
              aria-label={t("projects.createProject")}
            >
              <Plus className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Projects List */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-out)]",
          isOpen
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0 pointer-events-none"
        )}
      >
        <div className="overflow-hidden min-h-0 space-y-1">
          {projects.map((proj) => (
            <ProjectItem
              key={proj.id}
              project={proj}
              allProjects={projects}
              onNavigate={onNavigate}
              onRenameProject={onRenameProject}
              onTogglePinProject={onTogglePinProject}
              onDeleteProject={onDeleteProject}
              onShareProject={onShareProject}
              onRenameChat={onRenameChat}
              onTogglePinChat={onTogglePinChat}
              onShareChat={onShareChat}
              onArchiveChat={onArchiveChat}
              onDeleteChat={onDeleteChat}
              onMoveChatToProject={onMoveChatToProject}
              onCreateNewProjectForChat={onCreateNewProjectForChat}
              onLockChat={onLockChat}
            />
          ))}

          {!isLoading && projects.length === 0 && (
            <p className="px-2 py-1 text-[11px] text-[var(--placeholder)] italic">
              {t("projects.emptyProjects")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
