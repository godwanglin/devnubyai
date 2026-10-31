"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

export interface DocumentOutlineSidebarProps {
  heading: string;
  items: string[];
  /** 0-based active item */
  activeIndex: number;
  isOpen: boolean;
  onSelect: (index: number) => void;
}

/** Left rail listing sections (e.g. EPUB chapters) for documents without fixed pages. */
export function DocumentOutlineSidebar({ heading, items, activeIndex, isOpen, onSelect }: DocumentOutlineSidebarProps) {
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  useEffect(() => {
    if (!isOpen) return;
    itemRefs.current.get(activeIndex)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

  return (
    <nav
      aria-label={heading}
      aria-hidden={!isOpen}
      className={cn(
        "h-full bg-[var(--panel)]/85 border-r border-[var(--border)] select-none shrink-0 overflow-hidden transition-[width] duration-250 ease-[var(--ease-out)] motion-reduce:transition-none",
        isOpen ? "w-[200px]" : "w-0 border-r-0 pointer-events-none"
      )}
    >
      <div className="w-[200px] h-full overflow-y-auto px-2 py-3">
        <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--placeholder)]">{heading}</p>
        <ol className="space-y-0.5">
          {items.map((label, idx) => (
            <li key={idx}>
              <button
                ref={(el) => {
                  if (el) itemRefs.current.set(idx, el);
                  else itemRefs.current.delete(idx);
                }}
                type="button"
                onClick={() => onSelect(idx)}
                aria-current={idx === activeIndex ? "page" : undefined}
                className={cn(
                  "w-full flex items-baseline gap-2 px-2 py-1.5 rounded-[6px] text-left text-[12px] leading-snug transition-colors cursor-pointer",
                  idx === activeIndex
                    ? "bg-[var(--accent-soft)] text-[var(--ink)] font-medium"
                    : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                )}
              >
                <span className="font-mono text-[10.5px] tabular-nums text-[var(--placeholder)] shrink-0">{idx + 1}</span>
                <span className="min-w-0 line-clamp-2">{label}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
