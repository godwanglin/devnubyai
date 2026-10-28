"use client";

import React, { useState } from "react";
import {
  PanelLeft,
  Share2,
  Sun,
  Moon,
  MoreHorizontal,
  Pencil,
  Copy,
  Download,
  Trash2,
} from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { useTheme } from "@/providers/theme-provider";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";

interface ChatTopbarProps {
  title: string;
  onToggleSidebar: () => void;
  onDelete?: () => void;
}

export function ChatTopbar({ title, onToggleSidebar, onDelete }: ChatTopbarProps) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const { toast } = useToast();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <header className="flex items-center gap-3 h-14 px-3 sm:px-4.5 border-b border-[var(--border)] bg-[var(--panel)] shrink-0">
      <button
        type="button"
        onClick={onToggleSidebar}
        className="grid place-items-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
        aria-label={t("nav.showSidebar")}
      >
        <PanelLeft className="w-4 h-4" />
      </button>

      <div className="flex-1 min-w-0 flex justify-start">
        <span className="text-[15px] font-semibold text-[var(--ink)] truncate max-w-full">
          {title}
        </span>
      </div>

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => toast(t("toast.linkCopied"))}
          className="grid place-items-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
          aria-label={t("topbar.share")}
        >
          <Share2 className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          className="grid place-items-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
          aria-label={t("topbar.toggleTheme")}
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <Popover
          isOpen={moreOpen}
          onOpenChange={setMoreOpen}
          side="bottom"
          align="end"
          className="w-[220px]"
          trigger={
            <button
              type="button"
              className="grid place-items-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
              aria-label={t("topbar.moreOptions")}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          }
        >
          <div className="space-y-0.5">
            <DropdownItem
              icon={<Pencil className="w-3.5 h-3.5" />}
              onClick={() => {
                toast(t("toast.chatRenamed"));
                setMoreOpen(false);
              }}
            >
              {t("topbar.rename")}
            </DropdownItem>
            <DropdownItem
              icon={<Copy className="w-3.5 h-3.5" />}
              onClick={() => {
                toast(t("toast.chatDuplicated"));
                setMoreOpen(false);
              }}
            >
              {t("topbar.duplicate")}
            </DropdownItem>
            <DropdownItem
              icon={<Download className="w-3.5 h-3.5" />}
              onClick={() => {
                toast(t("toast.chatExported"));
                setMoreOpen(false);
              }}
            >
              {t("topbar.exportMarkdown")}
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem
              danger
              icon={<Trash2 className="w-3.5 h-3.5" />}
              onClick={() => {
                toast(t("toast.chatDeleted"));
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
