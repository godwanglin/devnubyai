"use client";

import React from "react";
import { MousePointerClick } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";

export interface RequestEditsButtonProps {
  active: boolean;
  onClick: () => void;
  className?: string;
}

/** "Request edits" button with pointer icon (Cursor-style) and text label. */
export function RequestEditsButton({
  active,
  onClick,
  className,
}: RequestEditsButtonProps) {
  const { t } = useI18n();

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 h-7 rounded-full text-xs font-medium transition-all cursor-pointer select-none shrink-0",
        active
          ? "bg-blue-600 text-white shadow-sm ring-2 ring-blue-400/40"
          : "text-[var(--ink)] bg-[var(--panel)] hover:bg-[var(--hover)] border border-[var(--border)]",
        className
      )}
    >
      <MousePointerClick className="w-3.5 h-3.5 shrink-0" />
      <span className="text-[11.5px]">{t("chatFiles.requestEdits")}</span>
    </button>
  );
}