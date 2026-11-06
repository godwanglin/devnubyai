"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { liveDocumentTitle, type LiveDocumentState } from "@/lib/chat/live-document";
import type { DraftDocument } from "@/lib/live-draft";
import { useI18n } from "@/providers/i18n-provider";
import { renderSessionFileIcon } from "../session-file-row";
import { FilePreviewSurface } from "./file-preview-surface";
import { DraftErrorBoundary } from "./live-draft/draft-error-boundary";
import { LiveDraftView } from "./live-draft/live-draft-view";

/** A failed attempt is not shown: the AI retries, and the panel just keeps "building". */
const PHASE_LABEL_KEY: Record<LiveDocumentState["phase"], string> = {
  writing: "chatFiles.liveWriting",
  running: "chatFiles.liveRunning",
  rendering: "chatFiles.liveRendering",
  error: "chatFiles.liveRunning",
};

/** Blank page with a spinner while the first draft is not ready yet. */
function DraftLoading() {
  const { t } = useI18n();
  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-[var(--surface)] px-4 py-4" style={{ scrollbarGutter: "stable" }}>
      <div className="mx-auto flex aspect-[210/297] w-full max-w-[640px] flex-col items-center justify-center gap-3 rounded-[3px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35),0_8px_24px_rgba(0,0,0,0.25)]">
        <Loader2 className="h-6 w-6 animate-spin text-[#94a3b8]" />
        <span className="text-[12px] text-[#64748b]">{t("chatFiles.livePreparing")}</span>
      </div>
    </div>
  );
}


/** Files panel header while a document is being built: its icon, name and a Live badge. */
export function LiveDocumentTitle({ live }: { live: LiveDocumentState }) {
  const { t } = useI18n();
  const fileName = live.preview?.displayName || live.filename;
  const title = liveDocumentTitle(live) || t("chatFiles.liveWaiting");
  return (
    <>
      {renderSessionFileIcon({ extension: fileName.split(".").pop() ?? "", isImage: false, mimeType: "" })}
      <h2 className="text-[14px] font-semibold text-[var(--ink)] truncate" title={fileName || undefined}>
        {title}
      </h2>
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-[5px] text-[10.5px] font-semibold uppercase tracking-wide shrink-0 bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
        {t("chatFiles.liveBadge")}
      </span>
    </>
  );
}

/**
 * Files panel body while a document is being built: the page-shaped live draft drawn
 * from the code as the AI writes it (a loading page until the first one is ready), then
 * every real version the script writes, until the final file replaces this view.
 * Failed attempts and broken drafts never show here: the panel keeps loading instead.
 */
export function LiveDocumentView({
  live,
  draft,
  draftVersion,
}: {
  live: LiveDocumentState;
  draft: DraftDocument | null;
  draftVersion: number;
}) {
  const { t } = useI18n();
  const building = live.phase !== "rendering";

  const freshPreview = live.preview && live.previewIsLive ? live.preview : null;
  const stalePreview = !freshPreview && !draft ? live.preview : null;

  let body: React.ReactNode;
  if (freshPreview) {
    body = (
      <div data-ask-selectable="true" className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <FilePreviewSurface key={freshPreview.url} file={freshPreview} />
      </div>
    );
  } else if (draft) {
    body = (
      <DraftErrorBoundary resetKey={String(draftVersion)} fallback={<DraftLoading />}>
        <LiveDraftView draft={draft} />
      </DraftErrorBoundary>
    );
  } else if (stalePreview) {
    body = (
      <div data-ask-selectable="true" className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <FilePreviewSurface key={stalePreview.url} file={stalePreview} />
      </div>
    );
  } else body = <DraftLoading />;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div
        className="flex items-center gap-2 px-4 sm:px-5 py-1.5 border-b border-[var(--border)] text-[12px] text-[var(--muted)] shrink-0 min-h-[38px]"
        role="status"
        aria-live="polite"
      >
        {building && !freshPreview ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        ) : (
          <span className="relative flex w-2 h-2 shrink-0">
            <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping motion-reduce:animate-none" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
          </span>
        )}
        <span className="truncate">
          {draft && !freshPreview && building ? t("chatFiles.liveDrafting") : t(PHASE_LABEL_KEY[live.phase])}
        </span>
      </div>
      {body}
    </div>
  );
}
