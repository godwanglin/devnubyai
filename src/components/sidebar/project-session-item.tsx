"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Lock,
  LockOpen,
  Share2,
  Archive,
  Trash2,
  FolderMinus,
  FolderSync,
  ChevronRight,
  Plus,
} from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";
import type { ProjectDto, ProjectRecentChat } from "@/lib/projects/types";

export interface ProjectSessionItemProps {
  chat: ProjectRecentChat;
  project: ProjectDto;
  allProjects?: ProjectDto[];
  active: boolean;
  onNavigate: () => void;
  onRename?: (chatId: string, title: string) => void;
  onTogglePin?: (chatId: string, nextPinned: boolean) => void;
  onShare?: (chatId: string) => void;
  onArchive?: (chatId: string) => void;
  onDelete?: (chatId: string, title: string) => void;
  onMoveToProject?: (chatId: string, targetProjectId: string | null) => void;
  onCreateNewProjectForChat?: (chatId: string) => void;
  onLockChat?: (chatId: string, nextLocked: boolean) => void;
}

export function ProjectSessionItem({
  chat,
  project,
  allProjects = [],
  active,
  onNavigate,
  onRename,
  onTogglePin,
  onShare,
  onArchive,
  onDelete,
  onMoveToProject,
  onCreateNewProjectForChat,
  onLockChat,
}: ProjectSessionItemProps) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveSubmenuOpen, setMoveSubmenuOpen] = useState(false);
  const isPinned = Boolean(chat.isPinned);
  const isLocked = Boolean(chat.isLocked);

  const otherProjects = allProjects.filter((p) => p.id !== project.id);

  return (
    <div
      className={cn(
        "group relative flex items-center rounded-[8px] transition-colors pl-6 pr-1",
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent)] font-medium"
          : menuOpen
            ? "bg-[var(--hover)] text-[var(--ink)]"
            : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
      )}
    >
      <Link
        href={`/project/${project.id}/c/${chat.id}`}
        onClick={onNavigate}
        className="flex-1 flex items-center gap-1.5 min-w-0 py-1.5 pr-1 text-[13px] truncate"
      >
        <span className="truncate">{chat.title}</span>
        {isLocked && <Lock className="w-3 h-3 text-[var(--placeholder)] shrink-0" />}
      </Link>

      <div
        className={cn(
          "flex items-center gap-0.5 shrink-0 transition-opacity duration-150",
          menuOpen
            ? "w-auto opacity-100"
            : "max-md:w-auto max-md:opacity-100 md:w-0 md:overflow-hidden md:opacity-0 md:group-hover:w-auto md:group-hover:overflow-visible md:group-hover:opacity-100 md:focus-within:w-auto md:focus-within:overflow-visible md:focus-within:opacity-100"
        )}
      >
        <Tooltip
          content={isPinned ? t("sidebarChat.unpin") : t("sidebarChat.pin")}
          side="top"
          align="end"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin?.(chat.id, !isPinned);
            }}
            className={cn(
              "grid place-items-center w-6 h-6 rounded-[6px] transition-colors cursor-pointer",
              isPinned
                ? "text-[var(--ink)] hover:bg-[var(--panel-elevated)]"
                : "text-[var(--muted)] hover:bg-[var(--panel-elevated)] hover:text-[var(--ink)]"
            )}
            aria-label={isPinned ? t("sidebarChat.unpin") : t("sidebarChat.pin")}
          >
            <Pin className={cn("w-3.5 h-3.5", isPinned && "fill-current")} />
          </button>
        </Tooltip>

        <Popover
          isOpen={menuOpen}
          onOpenChange={(open) => {
            setMenuOpen(open);
            if (!open) setMoveSubmenuOpen(false);
          }}
          side="bottom"
          align="end"
          className="w-[210px]"
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
            {moveSubmenuOpen ? (
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => setMoveSubmenuOpen(false)}
                  className="flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-[6px] text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)] transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5 rotate-180" />
                  <span>Kembali</span>
                </button>
                <DropdownSeparator />
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onCreateNewProjectForChat?.(chat.id);
                  }}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-[var(--accent)] hover:bg-[var(--hover)] transition-colors text-left"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t("projects.createNewProjectOption")}</span>
                </button>
                <DropdownSeparator />
                {otherProjects.length === 0 ? (
                  <p className="px-2.5 py-1.5 text-[11px] text-[var(--placeholder)]">
                    Tidak ada proyek lain
                  </p>
                ) : (
                  otherProjects.map((p) => (
                    <DropdownItem
                      key={p.id}
                      icon={<FolderSync className="w-3.5 h-3.5" />}
                      onClick={() => {
                        setMenuOpen(false);
                        onMoveToProject?.(chat.id, p.id);
                      }}
                    >
                      <span className="truncate">{p.name}</span>
                    </DropdownItem>
                  ))
                )}
              </div>
            ) : (
              <>
                <DropdownItem
                  icon={<Pencil className="w-3.5 h-3.5" />}
                  onClick={() => {
                    setMenuOpen(false);
                    onRename?.(chat.id, chat.title);
                  }}
                >
                  {t("sidebarChat.rename")}
                </DropdownItem>

                <DropdownItem
                  icon={
                    isPinned ? (
                      <PinOff className="w-3.5 h-3.5" />
                    ) : (
                      <Pin className="w-3.5 h-3.5" />
                    )
                  }
                  onClick={() => {
                    setMenuOpen(false);
                    onTogglePin?.(chat.id, !isPinned);
                  }}
                >
                  {isPinned ? t("sidebarChat.unpin") : t("sidebarChat.pin")}
                </DropdownItem>

                <DropdownItem
                  icon={
                    isLocked ? (
                      <LockOpen className="w-3.5 h-3.5" />
                    ) : (
                      <Lock className="w-3.5 h-3.5" />
                    )
                  }
                  onClick={() => {
                    setMenuOpen(false);
                    onLockChat?.(chat.id, !isLocked);
                  }}
                >
                  {isLocked ? t("sidebarChat.unlock") : t("sidebarChat.lock")}
                </DropdownItem>

                <DropdownSeparator />

                <DropdownItem
                  icon={<Share2 className="w-3.5 h-3.5" />}
                  onClick={() => {
                    setMenuOpen(false);
                    onShare?.(chat.id);
                  }}
                >
                  {t("topbar.share")}
                </DropdownItem>

                <DropdownSeparator />

                <DropdownItem
                  icon={<Archive className="w-3.5 h-3.5" />}
                  onClick={() => {
                    setMenuOpen(false);
                    onArchive?.(chat.id);
                  }}
                >
                  {t("sidebarChat.archive")}
                </DropdownItem>

                <DropdownItem
                  danger
                  icon={<Trash2 className="w-3.5 h-3.5" />}
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete?.(chat.id, chat.title);
                  }}
                >
                  {t("sidebarChat.delete")}
                </DropdownItem>

                <DropdownSeparator />

                {/* Section header: Project Name */}
                <div className="px-2.5 py-1 text-[11px] font-semibold text-[var(--muted)] truncate">
                  {project.name}
                </div>

                <button
                  type="button"
                  onClick={() => setMoveSubmenuOpen(true)}
                  className="flex items-center justify-between w-full px-2.5 py-1.5 rounded-[6px] text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors text-left"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <FolderSync className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{t("projects.moveToProject")}</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 text-[var(--placeholder)]" />
                </button>

                <DropdownItem
                  icon={<FolderMinus className="w-3.5 h-3.5" />}
                  onClick={() => {
                    setMenuOpen(false);
                    onMoveToProject?.(chat.id, null);
                  }}
                >
                  {t("projects.removeFromProject")}
                </DropdownItem>
              </>
            )}
          </div>
        </Popover>
      </div>
    </div>
  );
}
