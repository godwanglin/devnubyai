"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { dispatchAIEditRequest } from "@/lib/files/preview-events";
import { useI18n } from "@/providers/i18n-provider";
import type { PdfLiveEdit, PdfSelectedArea } from "./pdf-edit-types";
import { PdfPageSurface } from "./pdf-page-surface";
import { PdfSearchBar } from "./pdf-search-bar";
import { searchAllPages, type PdfSearchMatch } from "./pdf-search-utils";
import { PdfThumbnailsSidebar } from "./pdf-thumbnails-sidebar";
import { PdfToolbar } from "./pdf-toolbar";
import "./pdf-viewer.css";

export interface PdfFilePreviewProps {
  bytes: ArrayBuffer;
  title: string;
  fileId?: string;
  initialSearchQuery?: string;
}

interface PageMetric {
  pageNumber: number;
  baseWidth: number;
  baseHeight: number;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.8;
const ZOOM_STEP = 0.2;

export function PdfFilePreview({
  bytes,
  title,
  fileId,
  initialSearchQuery,
}: PdfFilePreviewProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const pageTextCacheRef = useRef<Map<number, string>>(new Map());

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [metrics, setMetrics] = useState<PageMetric[]>([]);
  const [failed, setFailed] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [manualScale, setManualScale] = useState<number | null>(null);
  const [showThumbnails, setShowThumbnails] = useState(true);

  // Search & Highlight states
  const [searchOpen, setSearchOpen] = useState(Boolean(initialSearchQuery));
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || "");
  const [matches, setMatches] = useState<PdfSearchMatch[]>([]);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);

  // Request Edits & Live Edit states
  const [requestEditsActive, setRequestEditsActive] = useState(false);
  const [debugMode, setDebugMode] = useState(true);
  const [selectedArea, setSelectedArea] = useState<PdfSelectedArea | null>(null);
  const [liveEdits, setLiveEdits] = useState<PdfLiveEdit[]>([]);

  const currentPageRef = useRef(currentPage);
  const currentMatchIdxRef = useRef(currentMatchIdx);
  const isJumpingRef = useRef(false);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    currentMatchIdxRef.current = currentMatchIdx;
  }, [currentMatchIdx]);

  // Jump to specific page
  const jumpToPage = useCallback(
    (target: number) => {
      if (!pdfDoc) return;
      const clamped = Math.max(1, Math.min(pdfDoc.numPages, target));
      setCurrentPage(clamped);
      currentPageRef.current = clamped;
      isJumpingRef.current = true;
      const node = pageRefs.current.get(clamped);
      node?.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => {
        isJumpingRef.current = false;
      }, 450);
    },
    [pdfDoc]
  );

  // Measure available width for Fit-Width scaling
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let initialized = false;

    const ro = new ResizeObserver(() => {
      const nextW = el.clientWidth;
      if (!initialized) {
        initialized = true;
        setContainerWidth(nextW);
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setContainerWidth(nextW), 110);
    });
    ro.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
    };
  }, [pdfDoc]);

  // Load PDF document via pdfjs-dist worker
  useEffect(() => {
    let active = true;
    let loadingTask: { destroy: () => Promise<void> } | null = null;
    pageTextCacheRef.current.clear();

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = "/workers/pdf.worker.min.mjs";
        }

        const data = new Uint8Array(bytes.slice(0));
        const task = pdfjs.getDocument({ data });
        loadingTask = task;
        const doc = await task.promise;
        if (!active) {
          await task.destroy();
          return;
        }

        const firstPage = await doc.getPage(1);
        const defaultVp = firstPage.getViewport({ scale: 1 });
        const pageMetrics: PageMetric[] = Array.from(
          { length: doc.numPages },
          (_, idx) => ({
            pageNumber: idx + 1,
            baseWidth: defaultVp.width,
            baseHeight: defaultVp.height,
          })
        );

        if (active) {
          setMetrics(pageMetrics);
          setPdfDoc(doc);
          setCurrentPage(1);
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      }
    })();

    return () => {
      active = false;
      if (loadingTask) {
        void loadingTask.destroy();
      }
    };
  }, [bytes]);

  // Shortcut Ctrl+F / Cmd+F to open search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen(true);
        setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 40);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Search across all pages when query changes (debounced)
  useEffect(() => {
    if (!pdfDoc || !searchOpen) return;
    const clean = searchQuery.trim();

    let active = true;
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      if (!clean) {
        setMatches([]);
        currentMatchIdxRef.current = -1;
        setCurrentMatchIdx(-1);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      try {
        const found = await searchAllPages(
          pdfDoc,
          clean,
          pageTextCacheRef.current,
          controller.signal
        );
        if (!active) return;
        setMatches(found);
        setIsSearching(false);

        if (found.length > 0) {
          const preferIdx = found.findIndex((m) => m.pageNumber >= currentPageRef.current);
          const nextIdx = preferIdx !== -1 ? preferIdx : 0;
          currentMatchIdxRef.current = nextIdx;
          setCurrentMatchIdx(nextIdx);
          jumpToPage(found[nextIdx].pageNumber);
        } else {
          currentMatchIdxRef.current = -1;
          setCurrentMatchIdx(-1);
        }
      } catch {
        if (active) {
          setIsSearching(false);
          setMatches([]);
          currentMatchIdxRef.current = -1;
          setCurrentMatchIdx(-1);
        }
      }
    }, 160);

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [pdfDoc, searchQuery, searchOpen, jumpToPage]);

  const basePageWidth = metrics[0]?.baseWidth || 612;
  const fitScale =
    containerWidth > 48
      ? Math.min(2.0, Math.max(MIN_SCALE, (containerWidth - 36) / basePageWidth))
      : 1;
  const effectiveScale = manualScale ?? fitScale;
  const zoomPercent = Math.round(effectiveScale * 100);

  function handleScroll() {
    if (isJumpingRef.current) return;
    const scroller = scrollRef.current;
    if (!scroller || metrics.length === 0) return;
    const midY = scroller.scrollTop + scroller.clientHeight * 0.35;
    let bestPage = 1;
    for (const [pageNum, el] of pageRefs.current.entries()) {
      if (el.offsetTop <= midY) {
        bestPage = pageNum;
      }
    }
    if (bestPage !== currentPageRef.current) {
      currentPageRef.current = bestPage;
      setCurrentPage(bestPage);
    }
  }

  function handleQueryChange(nextQuery: string) {
    setSearchQuery(nextQuery);
    if (!nextQuery.trim()) {
      setMatches([]);
      currentMatchIdxRef.current = -1;
      setCurrentMatchIdx(-1);
      setIsSearching(false);
    }
  }

  function toggleSearch() {
    const next = !searchOpen;
    setSearchOpen(next);
    if (next) {
      setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 40);
    } else {
      setSearchQuery("");
      setMatches([]);
      currentMatchIdxRef.current = -1;
      setCurrentMatchIdx(-1);
      setIsSearching(false);
    }
  }

  function toggleRequestEdits() {
    setRequestEditsActive((prev) => {
      const next = !prev;
      if (!next) setSelectedArea(null);
      return next;
    });
  }

  function handleSubmitEdit(prompt: string, area: PdfSelectedArea) {
    if (debugMode) {
      const newEdit: PdfLiveEdit = {
        id: `edit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        pageNumber: area.pageNumber,
        rect: area.rect,
        originalText: area.text,
        replacementText: prompt,
        createdAt: Date.now(),
      };
      setLiveEdits((prev) => [...prev, newEdit]);
      setSelectedArea(null);
    } else {
      dispatchAIEditRequest({
        fileId: fileId || "active-file",
        filename: title,
        selectedText: area.text,
        instruction: prompt,
        page: area.pageNumber,
      });
      setSelectedArea(null);
      setRequestEditsActive(false);
    }
  }

  function jumpToNextMatch() {
    if (matches.length === 0) return;
    const nextIdx = (currentMatchIdxRef.current + 1) % matches.length;
    currentMatchIdxRef.current = nextIdx;
    setCurrentMatchIdx(nextIdx);
    jumpToPage(matches[nextIdx].pageNumber);
  }

  function jumpToPrevMatch() {
    if (matches.length === 0) return;
    const prevIdx = (currentMatchIdx - 1 + matches.length) % matches.length;
    currentMatchIdxRef.current = prevIdx;
    setCurrentMatchIdx(prevIdx);
    jumpToPage(matches[prevIdx].pageNumber);
  }

  if (failed) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-xs text-[var(--muted)] text-center">
        {t("chatFiles.previewError")}
      </div>
    );
  }

  if (!pdfDoc) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-xs text-[var(--muted)]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        <span>{t("chatFiles.previewLoading")}</span>
      </div>
    );
  }

  const currentMatch =
    currentMatchIdx >= 0 && currentMatchIdx < matches.length
      ? matches[currentMatchIdx]
      : null;

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--surface)]" aria-label={title}>
      {/* PDF Toolbar */}
      <PdfToolbar
        numPages={pdfDoc.numPages}
        currentPage={currentPage}
        onPrevPage={() => jumpToPage(currentPage - 1)}
        onNextPage={() => jumpToPage(currentPage + 1)}
        showThumbnails={showThumbnails}
        onToggleThumbnails={() => setShowThumbnails((v) => !v)}
        canZoomIn={effectiveScale < MAX_SCALE - 0.01}
        canZoomOut={effectiveScale > MIN_SCALE + 0.01}
        zoomPercent={zoomPercent}
        onZoomIn={() =>
          setManualScale(
            Math.min(MAX_SCALE, Number((effectiveScale + ZOOM_STEP).toFixed(2)))
          )
        }
        onZoomOut={() =>
          setManualScale(
            Math.max(MIN_SCALE, Number((effectiveScale - ZOOM_STEP).toFixed(2)))
          )
        }
        onFitWidth={() => setManualScale(null)}
        searchOpen={searchOpen}
        onToggleSearch={toggleSearch}
        requestEditsActive={requestEditsActive}
        onToggleRequestEdits={toggleRequestEdits}
      />

      {/* Search Bar strip */}
      {searchOpen && (
        <PdfSearchBar
          inputRef={searchInputRef}
          query={searchQuery}
          onQueryChange={handleQueryChange}
          currentIndex={currentMatchIdx}
          totalMatches={matches.length}
          isSearching={isSearching}
          onNext={jumpToNextMatch}
          onPrev={jumpToPrevMatch}
          onClose={toggleSearch}
        />
      )}

      {/* Main Preview: Left Thumbnails + Continuous Pages */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <PdfThumbnailsSidebar
          doc={pdfDoc}
          pages={metrics}
          currentPage={currentPage}
          isOpen={showThumbnails}
          onSelectPage={jumpToPage}
        />

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="relative flex-1 min-w-0 min-h-0 overflow-auto px-4 py-5 space-y-5"
        >
          {metrics.map((m) => (
            <PdfPageSurface
              key={m.pageNumber}
              doc={pdfDoc}
              pageNumber={m.pageNumber}
              fallbackWidth={m.baseWidth}
              fallbackHeight={m.baseHeight}
              scale={effectiveScale}
              scrollRootRef={scrollRef}
              searchQuery={searchOpen ? searchQuery : ""}
              activeMatchIndexInPage={
                searchOpen && currentMatch?.pageNumber === m.pageNumber
                  ? currentMatch.matchIndexInPage
                  : null
              }
              requestEditsActive={requestEditsActive}
              debugMode={debugMode}
              onToggleDebugMode={() => setDebugMode((v) => !v)}
              selectedArea={selectedArea}
              onSelectArea={setSelectedArea}
              onSubmitEdit={handleSubmitEdit}
              liveEdits={liveEdits.filter((e) => e.pageNumber === m.pageNumber)}
              onRemoveLiveEdit={(id) =>
                setLiveEdits((prev) => prev.filter((e) => e.id !== id))
              }
              registerRef={(el) => {
                if (el) {
                  pageRefs.current.set(m.pageNumber, el);
                } else {
                  pageRefs.current.delete(m.pageNumber);
                }
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
