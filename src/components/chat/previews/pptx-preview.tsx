"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { PptxDocument } from "@/lib/files/parsers/pptx";
import { useDomTextSearch } from "@/hooks/use-dom-text-search";
import { useScrollPages } from "@/hooks/use-scroll-pages";
import { useViewerZoom } from "@/hooks/use-viewer-zoom";
import { useI18n } from "@/providers/i18n-provider";
import { DocumentSearchBar } from "./document-search-bar";
import { DocumentThumbnailsSidebar, THUMB_WIDTH } from "./document-thumbnails-sidebar";
import { DocumentToolbar } from "./document-toolbar";
import { DocumentViewerLayout } from "./document-viewer-layout";
import { SlideCanvas, SlideView } from "./pptx-slide-view";

export interface PptxPreviewProps {
  bytes: ArrayBuffer;
  title: string;
  initialSearchQuery?: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; doc: PptxDocument; mediaUrls: Map<string, string> }
  | { status: "error"; message: string | null };

const SLIDE_GAP_PX = 20;

/** Side-panel preview for PowerPoint decks: every slide at its true layout, with thumbnails, zoom and search. */
export function PptxPreview({ bytes, title, initialSearchQuery }: PptxPreviewProps) {
  const { t } = useI18n();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [showThumbnails, setShowThumbnails] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const deckRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    const created: string[] = [];
    (async () => {
      try {
        const { parsePptx } = await import("@/lib/files/parsers/pptx");
        const doc = await parsePptx(new Uint8Array(bytes.slice(0)));
        if (!active) return;
        const mediaUrls = new Map<string, string>();
        for (const [mediaPath, media] of doc.media) {
          const url = URL.createObjectURL(new Blob([media.bytes.slice()], { type: media.mime }));
          created.push(url);
          mediaUrls.set(mediaPath, url);
        }
        setState({ status: "ready", doc, mediaUrls });
      } catch (err) {
        if (active) setState({ status: "error", message: err instanceof Error ? err.message : null });
      }
    })();
    return () => {
      active = false;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [bytes]);

  const doc = state.status === "ready" ? state.doc : null;
  const zoom = useViewerZoom({ scrollRef, naturalWidth: doc?.width ?? 0, gutter: SLIDE_GAP_PX, min: 0.2, max: 3, maxFit: 2 });
  const getSlides = useCallback(
    () => (deckRef.current ? Array.from(deckRef.current.querySelectorAll<HTMLElement>(":scope > figure")) : []),
    []
  );
  const pages = useScrollPages({ scrollRef, getPages: getSlides, contentKey: doc });
  const search = useDomTextSearch({ rootRef: deckRef, scrollRef, contentKey: doc, initialQuery: initialSearchQuery });

  const slideCount = doc?.slides.length ?? 0;
  const current = Math.max(pages.currentPage, 1);

  return (
    <DocumentViewerLayout
      title={title}
      scrollRef={scrollRef}
      loading={state.status === "loading"}
      error={state.status === "error" ? state.message ?? "" : null}
      toolbar={
        <DocumentToolbar
          kindLabel="PPTX"
          paging={{
            numPages: Math.max(slideCount, 1),
            currentPage: current,
            onPrevPage: () => pages.jumpToPage(current - 1),
            onNextPage: () => pages.jumpToPage(current + 1),
            label: t("chatFiles.slideOf", { current, total: Math.max(slideCount, 1) }),
            prevLabel: t("chatFiles.prevSlide"),
            nextLabel: t("chatFiles.nextSlide"),
          }}
          showThumbnails={showThumbnails}
          onToggleThumbnails={() => setShowThumbnails((v) => !v)}
          canZoomIn={Boolean(doc) && zoom.canZoomIn}
          canZoomOut={Boolean(doc) && zoom.canZoomOut}
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
        state.status === "ready" && (
          <DocumentThumbnailsSidebar
            count={slideCount}
            currentPage={current}
            isOpen={showThumbnails}
            onSelectPage={pages.jumpToPage}
            aspectRatio={() => state.doc.height / state.doc.width}
            renderThumbnail={(n) => (
              <SlideCanvas
                slide={state.doc.slides[n - 1]}
                doc={state.doc}
                scale={THUMB_WIDTH / state.doc.width}
                mediaUrls={state.mediaUrls}
              />
            )}
          />
        )
      }
    >
      <div ref={deckRef} className="mx-auto w-fit flex flex-col px-5 py-5" style={{ gap: SLIDE_GAP_PX }}>
        {state.status === "ready" &&
          state.doc.slides.map((slide) => (
            <SlideView
              key={slide.number}
              slide={slide}
              doc={state.doc}
              scale={zoom.scale}
              mediaUrls={state.mediaUrls}
            />
          ))}
      </div>
    </DocumentViewerLayout>
  );
}
