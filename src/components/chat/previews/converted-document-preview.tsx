"use client";

import React, { useEffect, useRef, useState } from "react";
import { useDomTextSearch } from "@/hooks/use-dom-text-search";
import { useViewerZoom } from "@/hooks/use-viewer-zoom";
import { useI18n } from "@/providers/i18n-provider";
import { DocumentSearchBar } from "./document-search-bar";
import { DocumentToolbar } from "./document-toolbar";
import { DocumentViewerLayout } from "./document-viewer-layout";
import { DOCUMENT_PROSE_CLASS, sanitizeDocumentHtml } from "./sanitize-html";

export interface ConvertedDocumentPreviewProps {
  kind: "doc" | "rtf" | "odt";
  bytes: ArrayBuffer;
  title: string;
}

type ConvertState =
  | { status: "loading" }
  | { status: "ready"; html: string }
  | { status: "error"; message: string | null };

async function convertToHtml(kind: ConvertedDocumentPreviewProps["kind"], bytes: ArrayBuffer): Promise<string> {
  const input = new Uint8Array(bytes.slice(0));
  if (kind === "odt") {
    const { parseOdt } = await import("@/lib/files/parsers/odt");
    return (await parseOdt(input, { withImages: true })).html;
  }
  const { blocksToHtml } = await import("@/lib/files/parsers/text-blocks");
  if (kind === "rtf") {
    const { parseRtf, decodeRtfBytes } = await import("@/lib/files/parsers/rtf");
    return blocksToHtml(parseRtf(decodeRtfBytes(input)));
  }
  const { parseDoc } = await import("@/lib/files/parsers/doc");
  return blocksToHtml(await parseDoc(input));
}

/**
 * Side-panel preview for documents converted client-side to HTML: legacy Word (.doc),
 * Rich Text (.rtf) and OpenDocument Text (.odt). These formats carry no fixed pages, so
 * the shared chrome offers zoom and find-in-document only.
 */
export function ConvertedDocumentPreview({ kind, bytes, title }: ConvertedDocumentPreviewProps) {
  const { t } = useI18n();
  const [state, setState] = useState<ConvertState>({ status: "loading" });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const html = await convertToHtml(kind, bytes);
        if (active) setState({ status: "ready", html: sanitizeDocumentHtml(html || "<p></p>") });
      } catch (err) {
        if (active) setState({ status: "error", message: err instanceof Error ? err.message : null });
      }
    })();
    return () => {
      active = false;
    };
  }, [kind, bytes]);

  const html = state.status === "ready" ? state.html : null;
  const zoom = useViewerZoom({ scrollRef, naturalWidth: 0, min: 0.6, max: 2 });
  const search = useDomTextSearch({ rootRef: bodyRef, scrollRef, contentKey: html });

  return (
    <DocumentViewerLayout
      title={title}
      scrollRef={scrollRef}
      loading={state.status === "loading"}
      error={state.status === "error" ? state.message ?? "" : null}
      scrollClassName="bg-[var(--panel)] select-text"
      toolbar={
        <DocumentToolbar
          kindLabel={kind.toUpperCase()}
          canZoomIn={html !== null && zoom.canZoomIn}
          canZoomOut={html !== null && zoom.canZoomOut}
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
    >
      <div className="px-6 py-6" style={{ zoom: zoom.scale }}>
        {kind === "doc" && (
          <p className="max-w-[740px] mx-auto mb-4 text-[11.5px] text-[var(--placeholder)]">
            {t("chatFiles.textOnlyPreview")}
          </p>
        )}
        {html !== null && (
          <div ref={bodyRef} className={DOCUMENT_PROSE_CLASS} dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </DocumentViewerLayout>
  );
}
