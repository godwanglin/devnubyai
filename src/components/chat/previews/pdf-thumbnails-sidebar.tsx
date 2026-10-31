"use client";

import React, { useEffect, useRef } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { DocumentThumbnailsSidebar, THUMB_WIDTH } from "./document-thumbnails-sidebar";

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

export function PdfThumbnailsSidebar({
  doc,
  pages,
  currentPage,
  isOpen,
  onSelectPage,
}: PdfThumbnailsSidebarProps) {
  return (
    <DocumentThumbnailsSidebar
      count={pages.length}
      currentPage={currentPage}
      isOpen={isOpen}
      onSelectPage={onSelectPage}
      aspectRatio={(n) => {
        const p = pages[n - 1];
        return p ? p.baseHeight / Math.max(1, p.baseWidth) : 1.414;
      }}
      renderThumbnail={(n) => <PdfThumbnailCanvas doc={doc} pageNumber={n} />}
    />
  );
}

function PdfThumbnailCanvas({ doc, pageNumber }: { doc: PDFDocumentProxy; pageNumber: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: ReturnType<PDFPageProxy["render"]> | null = null;

    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;

        const unscaled = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: THUMB_WIDTH / Math.max(1, unscaled.width) });

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
  }, [doc, pageNumber]);

  return <canvas ref={canvasRef} className="block pointer-events-none" />;
}
