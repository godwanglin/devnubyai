"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export const THUMB_WIDTH = 82;
const EAGER_COUNT = 6;

export interface DocumentThumbnailsSidebarProps {
  count: number;
  currentPage: number;
  isOpen: boolean;
  onSelectPage: (page: number) => void;
  /** Height / width of a page (default A4 portrait) */
  aspectRatio?: (page: number) => number;
  /** Thumbnail content, THUMB_WIDTH px wide; only called once the item nears the viewport */
  renderThumbnail: (page: number) => React.ReactNode;
  /** Caption under the thumbnail (default: page number) */
  label?: (page: number) => React.ReactNode;
}

/** Left rail of lazily rendered page thumbnails, shared by PDF, DOCX and PPTX previews. */
export function DocumentThumbnailsSidebar({
  count,
  currentPage,
  isOpen,
  onSelectPage,
  aspectRatio,
  renderThumbnail,
  label,
}: DocumentThumbnailsSidebarProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Keep the active thumbnail visible while the main view scrolls
  useEffect(() => {
    if (!isOpen) return;
    itemRefs.current.get(currentPage)?.scrollIntoView({ block: "nearest" });
  }, [currentPage, isOpen]);

  return (
    <div
      aria-hidden={!isOpen}
      className={cn(
        "h-full bg-[var(--panel)]/85 border-r border-[var(--border)] select-none shrink-0 overflow-hidden transition-[width] duration-250 ease-[var(--ease-out)] motion-reduce:transition-none",
        isOpen ? "w-[124px]" : "w-0 border-r-0 pointer-events-none"
      )}
    >
      <div ref={scrollRef} className="w-[124px] h-full overflow-y-auto px-2.5 py-3 space-y-2.5">
        {Array.from({ length: count }, (_, i) => i + 1).map((page) => (
          <ThumbnailButton
            key={page}
            page={page}
            ratio={aspectRatio?.(page) ?? 1.414}
            isActive={page === currentPage}
            scrollRootRef={scrollRef}
            onSelect={() => onSelectPage(page)}
            renderThumbnail={renderThumbnail}
            label={label ? label(page) : page}
            registerRef={(el) => {
              if (el) itemRefs.current.set(page, el);
              else itemRefs.current.delete(page);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ThumbnailButton({
  page,
  ratio,
  isActive,
  scrollRootRef,
  onSelect,
  renderThumbnail,
  label,
  registerRef,
}: {
  page: number;
  ratio: number;
  isActive: boolean;
  scrollRootRef: React.RefObject<HTMLDivElement | null>;
  onSelect: () => void;
  renderThumbnail: (page: number) => React.ReactNode;
  label: React.ReactNode;
  registerRef: (el: HTMLButtonElement | null) => void;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(page <= EAGER_COUNT);
  const height = Math.max(40, Math.round(THUMB_WIDTH * ratio));

  useEffect(() => {
    if (visible) return;
    const el = btnRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { root: scrollRootRef.current, rootMargin: "320px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [scrollRootRef, visible]);

  return (
    <button
      ref={(el) => {
        btnRef.current = el;
        registerRef(el);
      }}
      type="button"
      onClick={onSelect}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group w-full flex flex-col items-center gap-1.5 py-1.5 px-1 rounded-[8px] transition-colors cursor-pointer",
        isActive ? "bg-[var(--hover)]" : "hover:bg-[var(--hover)]/60"
      )}
    >
      <span
        style={{ width: THUMB_WIDTH, height }}
        className={cn(
          "relative block rounded-[4px] bg-white overflow-hidden transition-all",
          isActive
            ? "ring-2 ring-[var(--ink)] shadow-xs"
            : "border border-[var(--border)] opacity-85 group-hover:opacity-100"
        )}
      >
        {visible && renderThumbnail(page)}
      </span>

      <span
        className={cn(
          "max-w-full truncate font-mono text-[10.5px] tabular-nums",
          isActive ? "font-semibold text-[var(--ink)]" : "text-[var(--muted)] group-hover:text-[var(--ink)]"
        )}
      >
        {label}
      </span>
    </button>
  );
}
