"use client";

import React from "react";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";

export type ProjectTabKey = "chats" | "sources";

export interface ProjectTabsProps {
  activeTab: ProjectTabKey;
  onChangeTab: (tab: ProjectTabKey) => void;
  chatCount?: number;
  sourceCount?: number;
}

export function ProjectTabs({
  activeTab,
  onChangeTab,
  chatCount,
  sourceCount,
}: ProjectTabsProps) {
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-2 border-b border-[var(--border)] pb-1 mb-4">
      <button
        type="button"
        onClick={() => onChangeTab("chats")}
        className={cn(
          "px-3.5 py-1.5 rounded-[8px] text-xs font-medium transition-colors cursor-pointer select-none",
          activeTab === "chats"
            ? "bg-[var(--panel-elevated)] text-[var(--ink)] font-semibold shadow-xs"
            : "text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)]/60"
        )}
      >
        <span>{t("projects.tabChats")}</span>
        {chatCount !== undefined && chatCount > 0 && (
          <span className="ml-1.5 text-[11px] text-[var(--placeholder)]">
            {chatCount}
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={() => onChangeTab("sources")}
        className={cn(
          "px-3.5 py-1.5 rounded-[8px] text-xs font-medium transition-colors cursor-pointer select-none",
          activeTab === "sources"
            ? "bg-[var(--panel-elevated)] text-[var(--ink)] font-semibold shadow-xs"
            : "text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)]/60"
        )}
      >
        <span>{t("projects.tabSources")}</span>
        {sourceCount !== undefined && sourceCount > 0 && (
          <span className="ml-1.5 text-[11px] text-[var(--placeholder)]">
            {sourceCount}
          </span>
        )}
      </button>
    </div>
  );
}
