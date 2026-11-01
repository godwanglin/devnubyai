"use client";

import React, { useState } from "react";
import { Folder, Share2, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import type { ProjectDetailDto } from "@/lib/projects/types";

export interface ProjectHeaderProps {
  project: ProjectDetailDto;
  onShare?: () => void;
  onRename: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}

export function ProjectHeader({
  project,
  onShare,
  onRename,
  onTogglePin,
  onDelete,
}: ProjectHeaderProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);

  function handleShare() {
    if (onShare) {
      onShare();
      return;
    }
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      toast("Tautan proyek disalin");
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 py-4 px-6 md:px-12 w-full max-w-4xl mx-auto">
      {/* Left: Folder icon + Title */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="grid place-items-center w-9 h-9 rounded-[10px] bg-[var(--panel-elevated)] border border-[var(--border)] text-[var(--accent)] shrink-0">
          <Folder className="w-5 h-5" />
        </div>
        <h1 className="text-xl font-semibold text-[var(--ink)] truncate">
          {project.name}
        </h1>
      </div>

      {/* Right: Bagikan button + (...) options */}
      <div className="flex items-center gap-2 shrink-0">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleShare}
          className="flex items-center gap-1.5 rounded-[10px] px-3.5 h-8 text-xs font-semibold bg-[var(--panel-elevated)] hover:bg-[var(--hover)] border border-[var(--border)] text-[var(--ink)]"
        >
          <Share2 className="w-3.5 h-3.5" />
          <span>{t("projects.shareProject")}</span>
        </Button>

        <Popover
          isOpen={menuOpen}
          onOpenChange={setMenuOpen}
          side="bottom"
          align="end"
          className="w-[190px]"
          trigger={
            <Tooltip content={t("sidebarChat.moreOptions")} side="bottom" align="end">
              <button
                type="button"
                className="grid place-items-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                aria-label={t("sidebarChat.moreOptions")}
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </Tooltip>
          }
        >
          <div className="space-y-0.5 text-xs">
            <DropdownItem
              icon={<Pencil className="w-3.5 h-3.5" />}
              onClick={() => {
                setMenuOpen(false);
                onRename();
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
                onTogglePin();
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
                onDelete();
              }}
            >
              {t("projects.deleteProject")}
            </DropdownItem>
          </div>
        </Popover>
      </div>
    </div>
  );
}
