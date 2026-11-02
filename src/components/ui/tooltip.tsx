"use client";

import React, { useCallback, useId, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export interface TooltipProps {
  content: string;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  children: React.ReactNode;
  className?: string;
}

export function Tooltip({
  content,
  side = "top",
  align = "center",
  children,
  className,
}: TooltipProps) {
  const id = useId();
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const show = Boolean(anchorRect && content) && typeof document !== "undefined";

  const positionTooltip = useCallback(
    (node: HTMLSpanElement | null) => {
      if (!node || !anchorRect) return;

      const w = node.offsetWidth;
      const h = node.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const gap = 8;
      const pad = 8;

      let left =
        align === "end"
          ? anchorRect.right - w
          : align === "start"
            ? anchorRect.left
            : anchorRect.left + (anchorRect.width - w) / 2;
      left = Math.min(Math.max(pad, left), Math.max(pad, vw - w - pad));

      let top = side === "top" ? anchorRect.top - h - gap : anchorRect.bottom + gap;
      if (side === "top" && top < pad) {
        top = anchorRect.bottom + gap;
      } else if (side === "bottom" && top + h > vh - pad) {
        top = anchorRect.top - h - gap;
      }
      top = Math.min(Math.max(pad, top), Math.max(pad, vh - h - pad));

      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
    },
    [anchorRect, align, side]
  );

  return (
    <span
      className={cn("inline-flex", className)}
      onMouseEnter={(e) => setAnchorRect(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setAnchorRect(null)}
      onFocus={(e) => setAnchorRect(e.currentTarget.getBoundingClientRect())}
      onBlur={() => setAnchorRect(null)}
      onPointerDown={() => setAnchorRect(null)}
    >
      <span aria-describedby={show ? id : undefined} className="inline-flex">
        {children}
      </span>
      {show &&
        createPortal(
          <span
            id={id}
            ref={positionTooltip}
            role="tooltip"
            style={{ top: 0, left: 0 }}
            className="fixed z-[10070] pointer-events-none glass tooltip-panel px-2.5 py-1.5 rounded-[6px] text-[12px] font-medium whitespace-nowrap text-[var(--ink)]"
          >
            {content}
          </span>,
          document.body
        )}
    </span>
  );
}
