"use client";

import React, { useId, useState } from "react";
import { cn } from "@/lib/cn";

export interface TooltipProps {
  content: string;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  children: React.ReactNode;
  className?: string;
}

export function Tooltip({ content, side = "top", align = "center", children, className }: TooltipProps) {
  const id = useId();
  const [show, setShow] = useState(false);

  const sideClass =
    side === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]";
  const alignClass =
    align === "end" ? "right-0" : align === "start" ? "left-0" : "left-1/2 -translate-x-1/2";

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      <span aria-describedby={show ? id : undefined}>{children}</span>
      {show && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            "absolute z-[130] pointer-events-none glass tooltip-panel px-2.5 py-1.5 rounded-[6px]",
            "text-[12px] font-medium whitespace-nowrap text-[var(--ink)]",
            sideClass,
            alignClass
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
