"use client";

import React from "react";
import Link from "next/link";
import { PanelLeftClose } from "lucide-react";
import { DevnubyWordmark } from "@/components/brand/devnuby-logo";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/providers/i18n-provider";

export interface SidebarHeaderProps {
  onToggleCollapse: () => void;
}

export function SidebarHeader({ onToggleCollapse }: SidebarHeaderProps) {
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-between gap-3 h-14 px-3.5 border-b border-[var(--border)] shrink-0">
      <Link href="/" className="flex items-center min-w-0" aria-label={t("brand.name")}>
        <DevnubyWordmark className="h-8 w-auto" />
      </Link>
      <Tooltip content={t("nav.hideSidebar")} side="bottom" align="end">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="grid place-items-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
          aria-label={t("nav.hideSidebar")}
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </Tooltip>
    </div>
  );
}
