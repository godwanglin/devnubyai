"use client";

import React from "react";
import { cn } from "@/lib/cn";

export interface PanelResizeHandleProps {
  edge: "left" | "right";
  isDragging: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onDoubleClick?: () => void;
  className?: string;
}

export function PanelResizeHandle({
  edge,
  isDragging,
  onPointerDown,
  onDoubleClick,
  className,
}: PanelResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        "group/resizer absolute inset-y-0 z-30 w-3 cursor-col-resize hidden md:flex items-center justify-center touch-none select-none",
        edge === "right" ? "-right-1.5" : "-left-1.5",
        className
      )}
    >
      <span
        className={cn(
          "w-1 h-20 rounded-full transition-colors",
          isDragging
            ? "bg-[var(--muted)]"
            : "bg-transparent group-hover/resizer:bg-[var(--border)]"
        )}
      />
    </div>
  );
}
