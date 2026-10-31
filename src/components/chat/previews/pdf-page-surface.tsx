"use client";

import React, { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { highlightPageSpans } from "./pdf-search-utils";
import { PdfRequestEditLayer } from "./pdf-request-edit-layer";
import type { PdfLiveEdit, PdfSelectedArea } from "./pdf-edit-types";

export interface PdfPageSurfaceProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  fallbackWidth: number;
  fallbackHeight: number;
  scale: number;
  scrollRootRef: React.RefObject<HTMLDivElement | null>;
  searchQuery: string;
  activeMatchIndexInPage: number | null;
  registerRef: (el: HTMLDivElement | null) => void;
  // Request Edits props
  requestEditsActive?: boolean;
  debugMode?: boolean;
  onToggleDebugMode?: () => void;
  selectedArea?: PdfSelectedArea | null;
  onSelectArea?: (sel: PdfSelectedArea | null) => void;
  onSubmitEdit?: (prompt: string, selectedArea: PdfSelectedArea) => void;
  liveEdits?: PdfLiveEdit[];
  onRemoveLiveEdit?: (id: string) => void;
}

export function PdfPageSurface({
  doc,
  pageNumber,
  fallbackWidth,
  fallbackHeight,
  scale,
  scrollRootRef,
  searchQuery,
  activeMatchIndexInPage,
  registerRef,
  requestEditsActive,
  debugMode,
  onToggleDebugMode,
  selectedArea,
  onSelectArea,
  onSubmitEdit,
  liveEdits,
  onRemoveLiveEdit,
}: PdfPageSurfaceProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);

  const [isNearViewport, setIsNearViewport] = useState(pageNumber <= 2);
  const [textLayerReady, setTextLayerReady] = useState(0);
  const [pageSize, setPageSize] = useState<{ w: number; h: number }>({
    w: Math.floor(fallbackWidth * scale),
    h: Math.floor(fallbackHeight * scale),
  });

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNearViewport(true);
        }
      },
      { root: scrollRootRef.current, rootMargin: "700px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [scrollRootRef]);

  // Render canvas & textLayer when near viewport
  useEffect(() => {
    if (!isNearViewport) return;

    let cancelled = false;
    let renderTask: ReturnType<PDFPageProxy["render"]> | null = null;
    let textLayerInstance: { cancel: () => void } | null = null;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        const cssW = Math.floor(viewport.width);
        const cssH = Math.floor(viewport.height);
        setPageSize({ w: cssW, h: cssH });

        const canvas = canvasRef.current;
        const textContainer = textLayerRef.current;
        if (!canvas || !textContainer) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;

        renderTask = page.render({
          canvas,
          canvasContext: ctx,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        await renderTask.promise;
        if (cancelled) return;

        textContainer.replaceChildren();
        const textLayer = new pdfjs.TextLayer({
          textContentSource: page.streamTextContent(),
          container: textContainer,
          viewport,
        });
        textLayerInstance = textLayer;
        await textLayer.render();
        if (cancelled) return;

        setTextLayerReady((v) => v + 1);
      } catch {
        // Ignore cancelled render tasks during rapid zoom/unmount
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayerInstance?.cancel();
    };
  }, [doc, pageNumber, scale, isNearViewport]);

  // Highlight matches whenever searchQuery, activeMatchIndexInPage, or textLayerReady updates
  useEffect(() => {
    const textContainer = textLayerRef.current;
    if (!textContainer || !isNearViewport || textLayerReady === 0) return;

    const target = highlightPageSpans(
      textContainer,
      searchQuery,
      activeMatchIndexInPage
    );
    if (target && activeMatchIndexInPage !== null) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [searchQuery, activeMatchIndexInPage, isNearViewport, textLayerReady]);

  const displayW = isNearViewport ? pageSize.w : Math.floor(fallbackWidth * scale);
  const displayH = isNearViewport ? pageSize.h : Math.floor(fallbackHeight * scale);

  return (
    <div
      ref={(el) => {
        wrapperRef.current = el;
        registerRef(el);
      }}
      style={
        {
          width: `${displayW}px`,
          height: `${displayH}px`,
          "--total-scale-factor": String(scale),
        } as React.CSSProperties
      }
      className="devnuby-pdf-page mx-auto"
    >
      <canvas ref={canvasRef} className="block pointer-events-none select-none" />
      <div ref={textLayerRef} className="textLayer" />
      <PdfRequestEditLayer
        pageNumber={pageNumber}
        pageWidth={displayW}
        active={Boolean(requestEditsActive)}
        debugMode={Boolean(debugMode)}
        onToggleDebugMode={onToggleDebugMode || (() => {})}
        selectedArea={selectedArea || null}
        onSelectArea={onSelectArea || (() => {})}
        onSubmitEdit={onSubmitEdit || (() => {})}
        textContainerRef={textLayerRef}
        liveEdits={liveEdits || []}
        onRemoveLiveEdit={onRemoveLiveEdit || (() => {})}
      />
    </div>
  );
}
