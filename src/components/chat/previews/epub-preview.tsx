"use client";

import React, { useEffect, useRef, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { EPUB_LINK_PREFIX, type EpubBook } from "@/lib/files/parsers/epub";
import { useDomTextSearch } from "@/hooks/use-dom-text-search";
import { useViewerZoom } from "@/hooks/use-viewer-zoom";
import { useI18n } from "@/providers/i18n-provider";
import { DocumentOutlineSidebar } from "./document-outline-sidebar";
import { DocumentSearchBar } from "./document-search-bar";
import { DocumentToolbar } from "./document-toolbar";
import { DocumentViewerLayout } from "./document-viewer-layout";
import { DOCUMENT_PROSE_CLASS, sanitizeDocumentHtml } from "./sanitize-html";

export interface EpubPreviewProps {
  bytes: ArrayBuffer;
  title: string;
}

type BookState =
  | { status: "loading" }
  | { status: "ready"; book: EpubBook }
  | { status: "error"; message: string | null };

interface ChapterContent {
  path: string;
  html: string;
  heading: string;
}

/**
 * Side-panel EPUB reader: one chapter at a time, chapter list on the left, zoom and
 * find-in-chapter (Ctrl+F) from the shared document chrome.
 */
export function EpubPreview({ bytes, title }: EpubPreviewProps) {
  const { t } = useI18n();
  const [bookState, setBookState] = useState<BookState>({ status: "loading" });
  const [chapterIdx, setChapterIdx] = useState(0);
  const [content, setContent] = useState<ChapterContent | null>(null);
  const [chapterError, setChapterError] = useState<{ path: string; message: string } | null>(null);
  const [showOutline, setShowOutline] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { openEpub } = await import("@/lib/files/parsers/epub");
        const book = await openEpub(new Uint8Array(bytes.slice(0)));
        if (active) setBookState({ status: "ready", book });
      } catch (err) {
        if (active) setBookState({ status: "error", message: err instanceof Error ? err.message : null });
      }
    })();
    return () => {
      active = false;
    };
  }, [bytes]);

  const book = bookState.status === "ready" ? bookState.book : null;
  const chapters = book?.chapters ?? [];
  const safeIdx = Math.min(chapterIdx, Math.max(chapters.length - 1, 0));
  const currentPath = chapters[safeIdx]?.path ?? null;

  useEffect(() => {
    if (!book || !currentPath) return;
    let active = true;
    (async () => {
      try {
        const { renderEpubChapter } = await import("@/lib/files/parsers/epub");
        const rendered = await renderEpubChapter(book, currentPath, { withImages: true });
        if (!active) return;
        setContent({
          path: currentPath,
          html: sanitizeDocumentHtml(rendered.html),
          heading: rendered.heading,
        });
      } catch (err) {
        if (active) {
          setChapterError({ path: currentPath, message: err instanceof Error ? err.message : "" });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [book, currentPath]);

  const shownPath = content?.path;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [shownPath]);

  // Prose column is ~740px wide; fit never upscales it
  const zoom = useViewerZoom({ scrollRef, naturalWidth: 0, min: 0.6, max: 2 });
  const search = useDomTextSearch({ rootRef: bodyRef, scrollRef, contentKey: shownPath });

  function chapterLabel(idx: number): string {
    const ch = chapters[idx];
    if (!ch) return "";
    if (ch.title) return ch.title;
    if (content?.path === ch.path && content.heading) return content.heading;
    return t("chatFiles.untitledChapter", { n: idx + 1 });
  }

  function handleContentClick(e: React.MouseEvent<HTMLDivElement>) {
    const anchor = (e.target as HTMLElement).closest("a");
    const href = anchor?.getAttribute("href") ?? "";
    if (!href.startsWith(EPUB_LINK_PREFIX)) return;
    e.preventDefault();
    let target = href.slice(EPUB_LINK_PREFIX.length);
    try {
      target = decodeURIComponent(target);
    } catch {
      // keep raw
    }
    const idx = chapters.findIndex((ch) => ch.path === target);
    if (idx !== -1) setChapterIdx(idx);
  }

  const errorForCurrent = chapterError?.path === currentPath ? chapterError.message : null;
  const isChapterLoading = content?.path !== currentPath && errorForCurrent === null;
  const total = Math.max(chapters.length, 1);

  return (
    <DocumentViewerLayout
      title={title}
      scrollRef={scrollRef}
      loading={bookState.status === "loading"}
      error={bookState.status === "error" ? bookState.message ?? "" : null}
      scrollClassName="bg-[var(--panel)] select-text"
      toolbar={
        <DocumentToolbar
          kindLabel="EPUB"
          paging={{
            numPages: total,
            currentPage: safeIdx + 1,
            onPrevPage: () => setChapterIdx(safeIdx - 1),
            onNextPage: () => setChapterIdx(safeIdx + 1),
            label: t("chatFiles.chapterLabel", { current: safeIdx + 1, total }),
            prevLabel: t("chatFiles.prevChapter"),
            nextLabel: t("chatFiles.nextChapter"),
          }}
          showThumbnails={showOutline}
          onToggleThumbnails={() => setShowOutline((v) => !v)}
          canZoomIn={Boolean(book) && zoom.canZoomIn}
          canZoomOut={Boolean(book) && zoom.canZoomOut}
          zoomPercent={zoom.zoomPercent}
          onZoomIn={zoom.zoomIn}
          onZoomOut={zoom.zoomOut}
          onFitWidth={zoom.fitWidth}
          searchOpen={search.open}
          onToggleSearch={search.toggle}
        />
      }
      searchBar={
        search.open && (
          <DocumentSearchBar
            inputRef={search.inputRef}
            query={search.query}
            onQueryChange={search.setQuery}
            currentIndex={search.index}
            totalMatches={search.total}
            isSearching={search.isSearching}
            onNext={search.next}
            onPrev={search.prev}
            onClose={search.toggle}
          />
        )
      }
      sidebar={
        book && (
          <DocumentOutlineSidebar
            heading={t("chatFiles.tableOfContents")}
            items={chapters.map((_, idx) => chapterLabel(idx))}
            activeIndex={safeIdx}
            isOpen={showOutline}
            onSelect={setChapterIdx}
          />
        )
      }
    >
      <div className="px-6 py-6" style={{ zoom: zoom.scale }}>
        {errorForCurrent !== null ? (
          <p className="text-center text-xs text-[var(--muted)] py-10">
            {errorForCurrent || t("chatFiles.previewError")}
          </p>
        ) : isChapterLoading || !content ? (
          <div className="flex items-center justify-center py-10 text-xs text-[var(--muted)]">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            <span>{t("chatFiles.previewLoading")}</span>
          </div>
        ) : (
          <>
            <div
              ref={bodyRef}
              className={DOCUMENT_PROSE_CLASS}
              onClick={handleContentClick}
              dangerouslySetInnerHTML={{ __html: content.html }}
            />
            {safeIdx < chapters.length - 1 && (
              <div className="max-w-[740px] mx-auto mt-10 pt-5 border-t border-[var(--border)] flex justify-end">
                <button
                  type="button"
                  onClick={() => setChapterIdx(safeIdx + 1)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[12.5px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                >
                  <span className="truncate max-w-[260px]">{chapterLabel(safeIdx + 1)}</span>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </DocumentViewerLayout>
  );
}
