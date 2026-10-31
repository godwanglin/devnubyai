"use client";

import React from "react";
import { cn } from "@/lib/cn";

export interface DropdownItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  danger?: boolean;
  icon?: React.ReactNode;
  /** Keyboard hint shown on the right, e.g. "Ctrl+Shift+B" */
  shortcut?: string;
}

export function DropdownItem({
  className,
  active,
  danger,
  icon,
  shortcut,
  children,
  ...props
}: DropdownItemProps) {
  return (
    <button
      type="button"
      className={cn(
        "glass-hover flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-[6px] text-sm text-[var(--ink)] cursor-pointer disabled:opacity-45 disabled:pointer-events-none",
        active && "bg-[var(--accent-soft)] text-[var(--accent)] font-medium",
        danger ? "text-red-500 hover:bg-red-500/10" : "",
        className
      )}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="flex-1 min-w-0">{children}</span>
      {shortcut && (
        <kbd className="shrink-0 font-sans text-[11px] font-normal text-[var(--placeholder)] tracking-wide">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

export function DropdownSeparator() {
  return <div className="h-px my-1 mx-1 bg-[var(--border)]" />;
}
