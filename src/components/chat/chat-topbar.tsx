"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  PanelLeft,
  Share2,
  Sun,
  Moon,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Copy,
  Folder,
  FolderOpen,
  Archive,
  ArchiveRestore,
  Trash2,
} from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { Tooltip } from "@/components/ui/tooltip";
import { useTheme } from "@/providers/theme-provider";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";

export interface ChatTopbarProps {
  title: string;
  projectName?: string | null;
  projectId?: string | null;
  isLoading?: boolean;
  hasActiveChat?: boolean;
  isPinned?: boolean;
  isArchived?: boolean;
  isShared?: boolean;
  isFilesOpen?: boolean;
  isDuplicating?: boolean;
  onToggleSidebar: () => void;
  onShare?: () => void;
  onRename?: () => void;
  onTogglePin?: () => void;
  onDuplicate?: () => void;
  onViewFiles?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
}

export function ChatTopbar({
  title,
  projectName,
  projectId,
  isLoading = false,
  hasActiveChat = false,
  isPinned = false,
  isArchived = false,
  isShared = false,
  isFilesOpen = false,
  isDuplicating = false,
  onToggleSidebar,
  onShare,
  onRename,
  onTogglePin,
  onDuplicate,
  onViewFiles,
  onArchive,
  onDelete,
}: ChatTopbarProps) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <header className="flex items-center gap-3 h-14 px-3 sm:px-4.5 border-b border-[var(--border)] bg-[var(--panel)] shrink-0">
      <Tooltip content={t("nav.showSidebar")} side="bottom" align="start">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="grid place-items-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
          aria-label={t("nav.showSidebar")}
        >
          <PanelLeft className="w-4 h-4" />
        </button>
      </Tooltip>

      <div className="flex-1 min-w-0 flex justify-start">
        {isLoading ? (
          <span
            className="h-4 w-32 rounded-md bg-[var(--hover)] animate-pulse"
            aria-label={t("common.loading")}
          />
        ) : (
          <div className="flex items-center gap-1.5 min-w-0 text-[15px] font-semibold text-[var(--ink)] truncate max-w-full">
            {projectName && projectId && (
              <>
                <Link
                  href={`/project/${projectId}`}
                  className="flex items-center gap-1.5 text-[var(--muted)] hover:text-[var(--ink)] transition-colors truncate max-w-[200px]"
                >
                  <Folder className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                  <span className="truncate">{projectName}</span>
                </Link>
                <span className="text-[var(--placeholder)] text-xs">/</span>
              </>
            )}
            <span className="truncate">{title}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-0.5">
        <Tooltip content={t("topbar.share")} side="bottom">
          <button
            type="button"
            onClick={() => onShare?.()}
            className={cn(
              "grid place-items-center w-8 h-8 rounded-[8px] transition-colors cursor-pointer",
              isShared
                ? "text-[var(--accent)] bg-[var(--accent-soft)] hover:opacity-90"
                : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
            )}
            aria-label={t("topbar.share")}
          >
            <Share2 className="w-4 h-4" />
          </button>
        </Tooltip>

        <Tooltip content={t("topbar.toggleTheme")} side="bottom">
          <button
            type="button"
            onClick={toggleTheme}
            className="grid place-items-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
            aria-label={t("topbar.toggleTheme")}
          >
            {resolvedTheme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </Tooltip>

        <Popover
          isOpen={moreOpen}
          onOpenChange={setMoreOpen}
          side="bottom"
          align="end"
          className="w-[235px]"
          trigger={
            <Tooltip content={moreOpen ? "" : t("topbar.moreOptions")} side="bottom" align="end">
              <button
                type="button"
                className="grid place-items-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                aria-label={t("topbar.moreOptions")}
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </Tooltip>
          }
        >
          <div className="space-y-0.5">
            <DropdownItem
              disabled={!hasActiveChat}
              icon={<Pencil className="w-3.5 h-3.5" />}
              onClick={() => {
                setMoreOpen(false);
                onRename?.();
              }}
            >
              {t("topbar.rename")}
            </DropdownItem>

            <DropdownItem
              disabled={!hasActiveChat}
              icon={
                isPinned ? (
                  <PinOff className="w-3.5 h-3.5" />
                ) : (
                  <Pin className="w-3.5 h-3.5" />
                )
              }
              onClick={() => {
                setMoreOpen(false);
                onTogglePin?.();
              }}
            >
              {isPinned ? t("topbar.unpin") : t("topbar.pin")}
            </DropdownItem>

            <DropdownItem
              disabled={!hasActiveChat || isDuplicating}
              icon={<Copy className="w-3.5 h-3.5" />}
              onClick={() => {
                setMoreOpen(false);
                onDuplicate?.();
              }}
            >
              {t("topbar.duplicate")}
            </DropdownItem>

            <DropdownItem
              disabled={!hasActiveChat}
              icon={<FolderOpen className="w-3.5 h-3.5" />}
              shortcut="Ctrl+Shift+B"
              className={isFilesOpen ? "text-[var(--ink)] font-medium" : undefined}
              onClick={() => {
                setMoreOpen(false);
                onViewFiles?.();
              }}
            >
              {t("topbar.viewFiles")}
            </DropdownItem>

            <DropdownItem
              disabled={!hasActiveChat}
              icon={
                isArchived ? (
                  <ArchiveRestore className="w-3.5 h-3.5" />
                ) : (
                  <Archive className="w-3.5 h-3.5" />
                )
              }
              onClick={() => {
                setMoreOpen(false);
                onArchive?.();
              }}
            >
              {isArchived ? t("topbar.unarchive") : t("topbar.archive")}
            </DropdownItem>

            <DropdownSeparator />

            <DropdownItem
              danger
              disabled={!hasActiveChat}
              icon={<Trash2 className="w-3.5 h-3.5" />}
              onClick={() => {
                setMoreOpen(false);
                onDelete?.();
              }}
            >
              {t("topbar.deleteChat")}
            </DropdownItem>
          </div>
        </Popover>
      </div>
    </header>
  );
}
