"use client";

import React, { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { cn } from "@/lib/cn";

export interface PdfThumbnailsSidebarProps {
  doc: PDFDocumentProxy;
  pages: Array<{
    pageNumber: number;
    baseWidth: number;
    baseHeight: number;
  }>;
  currentPage: number;
  isOpen: boolean;
  onSelectPage: (pageNumber: number) => void;
}

const THUMB_WIDTH = 82;

export function PdfThumbnailsSidebar({
  doc,
  pages,
  currentPage,
  isOpen,
  onSelectPage,
}: PdfThumbnailsSidebarProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Keep active thumbnail visible as user scrolls the main PDF
  useEffect(() => {
    if (!isOpen) return;
    const activeBtn = itemRefs.current.get(currentPage);
    activeBtn?.scrollIntoView({ block: "nearest" });
  }, [currentPage, isOpen]);

  return (
    <div
      aria-hidden={!isOpen}
      className={cn(
        "h-full bg-[var(--panel)]/85 border-r border-[var(--border)] select-none shrink-0 overflow-hidden transition-[width] duration-250 ease-[var(--ease-out)] motion-reduce:transition-none",
        isOpen ? "w-[124px]" : "w-0 border-r-0 pointer-events-none"
      )}
    >
      <div
        ref={scrollRef}
        className="w-[124px] h-full overflow-y-auto px-2.5 py-3 space-y-2.5"
      >
        {pages.map((p) => (
          <PdfThumbnailButton
            key={p.pageNumber}
            doc={doc}
            pageNumber={p.pageNumber}
            baseWidth={p.baseWidth}
            baseHeight={p.baseHeight}
            isActive={p.pageNumber === currentPage}
            scrollRootRef={scrollRef}
            onSelect={() => onSelectPage(p.pageNumber)}
            registerRef={(el) => {
              if (el) {
                itemRefs.current.set(p.pageNumber, el);
              } else {
                itemRefs.current.delete(p.pageNumber);
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

function PdfThumbnailButton({
  doc,
  pageNumber,
  baseWidth,
  baseHeight,
  isActive,
  scrollRootRef,
  onSelect,
  registerRef,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  baseWidth: number;
  baseHeight: number;
  isActive: boolean;
  scrollRootRef: React.RefObject<HTMLDivElement | null>;
  onSelect: () => void;
  registerRef: (el: HTMLButtonElement | null) => void;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [shouldRender, setShouldRender] = useState(pageNumber <= 6);

  const ratio = baseHeight / Math.max(1, baseWidth);
  const thumbH = Math.max(40, Math.round(THUMB_WIDTH * ratio));

  useEffect(() => {
    if (shouldRender) return;
    const el = btnRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShouldRender(true);
        }
      },
      { root: scrollRootRef.current, rootMargin: "320px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [scrollRootRef, shouldRender]);

  useEffect(() => {
    if (!shouldRender) return;
    let cancelled = false;
    let renderTask: ReturnType<PDFPageProxy["render"]> | null = null;

    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;

        const unscaled = page.getViewport({ scale: 1 });
        const scale = THUMB_WIDTH / Math.max(1, unscaled.width);
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
        canvas.style.width = `${Math.round(viewport.width)}px`;
        canvas.style.height = `${Math.round(viewport.height)}px`;

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;

        renderTask = page.render({
          canvas,
          canvasContext: ctx,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        await renderTask.promise;
      } catch {
        // Ignore cancelled thumbnail render
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, shouldRender]);

  return (
    <button
      ref={(el) => {
        btnRef.current = el;
        registerRef(el);
      }}
      type="button"
      onClick={onSelect}
      className={cn(
        "group w-full flex flex-col items-center gap-1.5 py-1.5 px-1 rounded-[8px] transition-colors cursor-pointer",
        isActive ? "bg-[var(--hover)]" : "hover:bg-[var(--hover)]/60"
      )}
    >
      <span
        style={{ width: `${THUMB_WIDTH}px`, minHeight: `${thumbH}px` }}
        className={cn(
          "block rounded-[4px] bg-white overflow-hidden transition-all",
          isActive
            ? "ring-2 ring-[var(--ink)] shadow-xs"
            : "border border-[var(--border)] opacity-85 group-hover:opacity-100"
        )}
      >
        <canvas ref={canvasRef} className="block pointer-events-none" />
      </span>

      <span
        className={cn(
          "font-mono text-[10.5px] tabular-nums",
          isActive
            ? "font-semibold text-[var(--ink)]"
            : "text-[var(--muted)] group-hover:text-[var(--ink)]"
        )}
      >
        {pageNumber}
      </span>
    </button>
  );
}
