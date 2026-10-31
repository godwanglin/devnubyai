"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDomTextSearch } from "@/hooks/use-dom-text-search";
import { useScrollPages } from "@/hooks/use-scroll-pages";
import { useViewerZoom } from "@/hooks/use-viewer-zoom";
import { DomPageThumbnail } from "./dom-page-thumbnail";
import { DomRequestEditLayer, type DomSelectedArea } from "./dom-request-edit-layer";
import { DocumentSearchBar } from "./document-search-bar";
import { DocumentThumbnailsSidebar } from "./document-thumbnails-sidebar";
import { DocumentToolbar } from "./document-toolbar";
import { DocumentViewerLayout } from "./document-viewer-layout";
import { DOCX_PAGE_WRAPPER_CLASS, renderDocxPages } from "./docx-render";
import { isSafeUrl } from "./sanitize-html";
import "./docx-page-preview.css";

export interface DocxPagePreviewProps {
  bytes: ArrayBuffer;
  title: string;
  fileId?: string;
  initialSearchQuery?: string;
}

type RenderState = "loading" | "ready" | "error";

const PAGE_GUTTER = 20;
const PAGE_WRAPPER_CLASS = DOCX_PAGE_WRAPPER_CLASS;

/**
 * Neutralizes anything in docx-preview's output that could act outside the page:
 * unsafe link targets (javascript:, file:, ...) and frames.
 */
function hardenRenderedDocx(root: HTMLElement) {
  for (const a of Array.from(root.querySelectorAll("a"))) {
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#")) continue;
    if (isSafeUrl(href, false)) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    } else {
      a.removeAttribute("href");
    }
  }
  root.querySelectorAll("iframe, object, embed, script").forEach((el) => el.remove());
}

function docxPages(body: HTMLElement | null): HTMLElement[] {
  return body ? Array.from(body.querySelectorAll<HTMLElement>(`.${PAGE_WRAPPER_CLASS} > section.docx`)) : [];
}

/**
 * Side-panel DOCX preview rendered as real pages (like Word): page size and margins,
 * fonts, colors, tables, images, headers and footers. Thumbnails, zoom, find-in-document
 * and "Request edits" share the same chrome as the PDF viewer.
 */
export function DocxPagePreview({ bytes, title, fileId, initialSearchQuery }: DocxPagePreviewProps) {
  const [state, setState] = useState<RenderState>("loading");
  const [renderVersion, setRenderVersion] = useState(0);
  const [renderedText, setRenderedText] = useState("");
  const [pageWidth, setPageWidth] = useState(0);
  const [pageEls, setPageEls] = useState<HTMLElement[]>([]);
  const [showThumbnails, setShowThumbnails] = useState(true);
  const [requestEditsActive, setRequestEditsActive] = useState(false);
  const [debugMode, setDebugMode] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const styleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const body = bodyRef.current;
    const styles = styleRef.current;
    if (!body || !styles) return;
    let active = true;

    (async () => {
      try {
        if (!(await renderDocxPages(bytes, body, styles, () => active))) return;
        hardenRenderedDocx(body);
        const pages = docxPages(body);
        setPageEls(pages);
        setPageWidth(Math.max(0, ...pages.map((p) => p.offsetWidth)));
        setRenderedText(body.innerText);
        setRenderVersion((v) => v + 1);
        setState("ready");
      } catch {
        if (active) setState("error");
      }
    })();

    return () => {
      active = false;
      body.innerHTML = "";
      styles.innerHTML = "";
    };
  }, [bytes]);

  const zoom = useViewerZoom({ scrollRef, naturalWidth: pageWidth, gutter: PAGE_GUTTER, min: 0.2, max: 2.5 });
  const getPages = useCallback(() => docxPages(bodyRef.current), []);
  const pages = useScrollPages({ scrollRef, getPages, contentKey: renderVersion });
  const search = useDomTextSearch({
    rootRef: bodyRef,
    scrollRef,
    contentKey: renderVersion,
    initialQuery: initialSearchQuery,
  });

  function handleDomEditSubmit(prompt: string, selectedArea: DomSelectedArea) {
    // Debug mode previews the instruction in place; real edits go through the AI prompt
    if (!debugMode || !bodyRef.current) return;
    const walker = document.createTreeWalker(bodyRef.current, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      if (text.includes(selectedArea.text)) {
        node.textContent = text.replace(selectedArea.text, prompt);
        break;
      }
    }
  }

  const ready = state === "ready";
  const pageCount = Math.max(pages.pageCount, 1);

  return (
    <DocumentViewerLayout
      title={title}
      scrollRef={scrollRef}
      loading={state === "loading"}
      error={state === "error" ? "" : null}
      scrollClassName={requestEditsActive ? "cursor-crosshair select-none" : "select-text"}
      toolbar={
        <DocumentToolbar
          kindLabel="DOCX"
          paging={{
            numPages: pageCount,
            currentPage: pages.currentPage,
            onPrevPage: () => pages.jumpToPage(pages.currentPage - 1),
            onNextPage: () => pages.jumpToPage(pages.currentPage + 1),
          }}
          showThumbnails={showThumbnails}
          onToggleThumbnails={() => setShowThumbnails((v) => !v)}
          canZoomIn={ready && zoom.canZoomIn}
          canZoomOut={ready && zoom.canZoomOut}
          zoomPercent={zoom.zoomPercent}
          onZoomIn={zoom.zoomIn}
          onZoomOut={zoom.zoomOut}
          onFitWidth={zoom.fitWidth}
          searchOpen={search.open}
          onToggleSearch={search.toggle}
          requestEditsActive={requestEditsActive}
          onToggleRequestEdits={ready ? () => setRequestEditsActive((v) => !v) : undefined}
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
        ready && (
          <DocumentThumbnailsSidebar
            count={pageEls.length}
            currentPage={pages.currentPage}
            isOpen={showThumbnails}
            onSelectPage={pages.jumpToPage}
            aspectRatio={(n) => {
              const el = pageEls[n - 1];
              return el && el.offsetWidth ? el.offsetHeight / el.offsetWidth : 1.414;
            }}
            renderThumbnail={(n) => (
              <DomPageThumbnail source={pageEls[n - 1]} wrapperClassName={PAGE_WRAPPER_CLASS} />
            )}
          />
        )
      }
    >
      <div ref={styleRef} hidden />
      <div
        ref={bodyRef}
        className="devnuby-docx-pages"
        style={{ zoom: zoom.scale, padding: `${PAGE_GUTTER / zoom.scale}px` }}
      />

      {ready && (
        <DomRequestEditLayer
          containerRef={scrollRef}
          active={requestEditsActive}
          content={renderedText}
          fileId={fileId}
          filename={title}
          debugMode={debugMode}
          onToggleDebugMode={() => setDebugMode((v) => !v)}
          onSubmitEdit={handleDomEditSubmit}
          onCancel={() => setRequestEditsActive(false)}
        />
      )}
    </DocumentViewerLayout>
  );
}
