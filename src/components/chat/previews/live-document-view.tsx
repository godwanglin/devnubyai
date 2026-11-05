"use client";

import React, { useEffect, useRef, useState } from "react";
import { Code2, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LiveDocumentState } from "@/lib/chat/live-document";
import type { DraftDocument } from "@/lib/live-draft";
import { useI18n } from "@/providers/i18n-provider";
import { renderSessionFileIcon } from "../session-file-row";
import { FilePreviewSurface } from "./file-preview-surface";
import { DraftErrorBoundary } from "./live-draft/draft-error-boundary";
import { LiveDraftView } from "./live-draft/live-draft-view";

const SOURCE_TAIL_LINES = 400;

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

function SourceTail({ source }: { source: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLPreElement>(null);
  const lines = source.split("\n");
  const tail = lines.length > SOURCE_TAIL_LINES ? lines.slice(-SOURCE_TAIL_LINES).join("\n") : source;

  // Follow the code as it streams in
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tail]);

  return (
    <div className="flex-1 min-h-0 flex flex-col px-4 sm:px-5 py-3 gap-2">
      <p className="text-[11.5px] font-medium text-[var(--muted)] shrink-0">
        {tail ? t("chatFiles.liveSourceTitle") : t("chatFiles.liveWaiting")}
      </p>
      {tail ? (
        <pre
          ref={ref}
          className="flex-1 min-h-0 overflow-auto rounded-[8px] border border-[var(--border)] bg-[var(--panel-elevated)] p-3 font-mono text-[11.5px] leading-relaxed text-[var(--ink)] whitespace-pre"
        >
          {tail}
        </pre>
      ) : (
        <div className="flex-1 min-h-0 rounded-[8px] border border-[var(--border)] bg-[var(--panel-elevated)] p-6 space-y-3 animate-pulse">
          {[72, 94, 88, 60, 90, 80, 45].map((w, i) => (
            <span key={i} className="block h-2.5 rounded bg-[var(--hover)]" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}


/** Files panel header while a document is being built: its icon, name and a Live badge. */
export function LiveDocumentTitle({ live }: { live: LiveDocumentState }) {
  const { t } = useI18n();
  const name = live.preview?.displayName || live.filename || t("chatFiles.liveWaiting");
  return (
    <>
      {renderSessionFileIcon({ extension: name.split(".").pop() ?? "", isImage: false, mimeType: "" })}
      <h2 className="text-[14px] font-semibold text-[var(--ink)] truncate">{name}</h2>
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
  const [tab, setTab] = useState<"draft" | "code">("draft");
  const building = live.phase !== "rendering";

  const freshPreview = live.preview && live.previewIsLive ? live.preview : null;
  const stalePreview = !freshPreview && !draft ? live.preview : null;
  const canSwitch = !freshPreview && Boolean(live.source);
  const showCode = canSwitch && tab === "code";

  let body: React.ReactNode;
  if (showCode) body = <SourceTail source={live.source} />;
  else if (freshPreview) {
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
        {canSwitch ? (
          <div className="ml-auto flex items-center gap-0.5 shrink-0" role="tablist">
            <Button
              size="sm"
              variant={tab === "draft" ? "secondary" : "ghost"}
              role="tab"
              aria-selected={tab === "draft"}
              onClick={() => setTab("draft")}
              className="h-7 px-2 text-[12px]"
            >
              <FileText className="w-3.5 h-3.5" />
              {t("chatFiles.liveTabDraft")}
            </Button>
            <Button
              size="sm"
              variant={tab === "code" ? "secondary" : "ghost"}
              role="tab"
              aria-selected={tab === "code"}
              onClick={() => setTab("code")}
              className="h-7 px-2 text-[12px]"
            >
              <Code2 className="w-3.5 h-3.5" />
              {t("chatFiles.liveTabCode")}
            </Button>
          </div>
        ) : null}
      </div>
      {body}
    </div>
  );
}
