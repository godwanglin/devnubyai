"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Folder,
  FolderOpen,
  MoreHorizontal,
  SquarePen,
  Pencil,
  Pin,
  PinOff,
  Share2,
  Trash2,
} from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";
import { ProjectSessionItem } from "./project-session-item";
import type { ProjectDto } from "@/lib/projects/types";

export interface ProjectItemProps {
  project: ProjectDto;
  allProjects: ProjectDto[];
  onNavigate: () => void;
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

export function ProjectItem({
  project,
  allProjects,
  onNavigate,
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
}: ProjectItemProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  const isProjectActive =
    pathname === `/project/${project.id}` ||
    pathname.startsWith(`/project/${project.id}/`);

  const recentChats = project.recentChats.slice(0, 5);
  const hasMoreChats = project.chatCount > 5;

  function handleCreateChatClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onNavigate();
    router.push(`/project/${project.id}`);
  }

  return (
    <div className="space-y-0.5">
      {/* Root Project Item Row (Gambar 1 Batch 2) */}
      <div
        className={cn(
          "group relative flex items-center rounded-[8px] transition-colors pr-1 cursor-pointer select-none",
          isProjectActive && pathname === `/project/${project.id}`
            ? "bg-[var(--panel-elevated)] text-[var(--ink)] font-medium"
            : menuOpen
              ? "bg-[var(--hover)] text-[var(--ink)]"
              : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
        )}
      >
        {/* Project name toggles expand/collapse; the pen button opens the project home */}
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
          className="flex-1 flex items-center gap-2 min-w-0 py-2 pl-2 pr-1 text-left text-[13.5px] truncate cursor-pointer"
        >
          <span className="relative w-4 h-4 shrink-0 text-[var(--accent)]">
            <Folder
              className={cn(
                "absolute inset-0 w-4 h-4 transition-[opacity,transform] duration-200 ease-[var(--ease-out)]",
                isExpanded ? "opacity-0 scale-75" : "opacity-100 scale-100"
              )}
            />
            <FolderOpen
              className={cn(
                "absolute inset-0 w-4 h-4 transition-[opacity,transform] duration-200 ease-[var(--ease-out)]",
                isExpanded ? "opacity-100 scale-100" : "opacity-0 scale-75"
              )}
            />
          </span>
          <span className="truncate">{project.name}</span>
        </button>

        {/* Hover Actions: (...) and (New Chat / SquarePen) */}
        <div
          className={cn(
            "flex items-center gap-0.5 shrink-0 transition-opacity duration-150",
            menuOpen
              ? "w-auto opacity-100"
              : "max-md:w-auto max-md:opacity-100 md:w-0 md:overflow-hidden md:opacity-0 md:group-hover:w-auto md:group-hover:overflow-visible md:group-hover:opacity-100 md:focus-within:w-auto md:focus-within:overflow-visible md:focus-within:opacity-100"
          )}
        >
          {/* Popover Menu (...) */}
          <Popover
            isOpen={menuOpen}
            onOpenChange={setMenuOpen}
            side="bottom"
            align="end"
            className="w-[190px]"
            trigger={
              <Tooltip
                content={menuOpen ? "" : t("sidebarChat.moreOptions")}
                side="top"
                align="end"
              >
                <button
                  type="button"
                  className="grid place-items-center w-6 h-6 rounded-[6px] text-[var(--muted)] hover:bg-[var(--panel-elevated)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                  aria-label={t("sidebarChat.moreOptions")}
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            }
          >
            <div className="space-y-0.5 text-xs">
              <DropdownItem
                icon={<Share2 className="w-3.5 h-3.5" />}
                onClick={() => {
                  setMenuOpen(false);
                  onShareProject?.(project);
                }}
              >
                {t("projects.shareProject")}
              </DropdownItem>

              <DropdownItem
                icon={<Pencil className="w-3.5 h-3.5" />}
                onClick={() => {
                  setMenuOpen(false);
                  onRenameProject(project);
                }}
              >
                {t("projects.renameProject")}
              </DropdownItem>

              <DropdownItem
                icon={
                  project.isPinned ? (
                    <PinOff className="w-3.5 h-3.5" />
                  ) : (
                    <Pin className="w-3.5 h-3.5" />
                  )
                }
                onClick={() => {
                  setMenuOpen(false);
                  onTogglePinProject(project);
                }}
              >
                {project.isPinned
                  ? t("projects.unpinProject")
                  : t("projects.pinProject")}
              </DropdownItem>

              <DropdownSeparator />

              <DropdownItem
                danger
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => {
                  setMenuOpen(false);
                  onDeleteProject(project);
                }}
              >
                {t("projects.deleteProject")}
              </DropdownItem>
            </div>
          </Popover>

          {/* New Chat in Project Button */}
          <Tooltip content={t("projects.newChatInProject")} side="top" align="end">
            <button
              type="button"
              onClick={handleCreateChatClick}
              className="grid place-items-center w-6 h-6 rounded-[6px] text-[var(--muted)] hover:bg-[var(--panel-elevated)] hover:text-[var(--ink)] transition-colors cursor-pointer"
              aria-label={t("projects.newChatInProject")}
            >
              <SquarePen className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Nested Chats List (max 5) */}
      <div
        inert={!isExpanded}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-out)]",
          isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
        )}
      >
        <div className="overflow-hidden min-h-0">
          <div className="space-y-0.5">
            {recentChats.map((chat) => (
              <ProjectSessionItem
                key={chat.id}
                chat={chat}
                project={project}
                allProjects={allProjects}
                active={pathname === `/project/${project.id}/c/${chat.id}`}
                onNavigate={onNavigate}
                onRename={onRenameChat}
                onTogglePin={onTogglePinChat}
                onShare={onShareChat}
                onArchive={onArchiveChat}
                onDelete={onDeleteChat}
                onMoveToProject={onMoveChatToProject}
                onCreateNewProjectForChat={onCreateNewProjectForChat}
                onLockChat={onLockChat}
              />
            ))}

            {/* "Lihat selengkapnya" button if has more than 5 chats or user wants to view project home */}
            {hasMoreChats && (
              <Link
                href={`/project/${project.id}`}
                onClick={onNavigate}
                className="block pl-7 py-1 text-[11px] font-medium text-[var(--placeholder)] hover:text-[var(--accent)] transition-colors"
              >
                {t("projects.seeMoreChats")} ({project.chatCount})
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
