"use client";

import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export interface CollapsibleGroupProps {
  label: string;
  icon?: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export function CollapsibleGroup({
  label,
  icon,
  isOpen,
  onToggle,
  children,
}: CollapsibleGroupProps) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="group/grp flex items-center justify-between gap-1.5 w-full px-1.5 py-1 rounded-[6px] text-[11px] font-semibold text-[var(--placeholder)] hover:text-[var(--ink)] hover:bg-[var(--hover)]/60 transition-colors cursor-pointer select-none"
      >
        <span className="flex items-center gap-1.5 min-w-0 truncate">
          {icon && <span className="shrink-0">{icon}</span>}
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 shrink-0 text-[var(--placeholder)] group-hover/grp:text-[var(--ink)] transition-transform duration-200 ease-[var(--ease-out)]",
            !isOpen && "-rotate-90"
          )}
        />
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity,margin] duration-200 ease-[var(--ease-out)]",
          isOpen
            ? "grid-rows-[1fr] opacity-100 mt-1"
            : "grid-rows-[0fr] opacity-0 mt-0 pointer-events-none"
        )}
      >
        <div className="overflow-hidden min-h-0">
          <div className="space-y-0.5">{children}</div>
        </div>
      </div>
    </div>
  );
}
