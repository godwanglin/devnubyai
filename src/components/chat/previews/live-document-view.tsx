"use client";

import React, { useEffect, useRef } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { LiveDocumentState } from "@/lib/chat/live-document";
import { useI18n } from "@/providers/i18n-provider";
import { FilePreviewSurface } from "./file-preview-surface";

const SOURCE_TAIL_LINES = 400;

const PHASE_LABEL_KEY: Record<LiveDocumentState["phase"], string> = {
  writing: "chatFiles.liveWriting",
  running: "chatFiles.liveRunning",
  rendering: "chatFiles.liveRendering",
  error: "chatFiles.liveError",
};

/** Files panel body while a document is being built: status, streaming code, then the live render. */
export function LiveDocumentView({ live }: { live: LiveDocumentState }) {
  const { t } = useI18n();
  const sourceRef = useRef<HTMLPreElement>(null);

  const lines = live.source.split("\n");
  const tail = lines.length > SOURCE_TAIL_LINES ? lines.slice(-SOURCE_TAIL_LINES).join("\n") : live.source;

  // Follow the code as it streams in
  useEffect(() => {
    const el = sourceRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tail]);

  const isError = live.phase === "error";
  const isBusy = live.phase === "writing" || live.phase === "running";

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div
        className={cn(
          "flex items-center gap-2 px-4 sm:px-5 py-2 border-b border-[var(--border)] text-[12px] shrink-0",
          isError ? "text-red-400" : "text-[var(--muted)]"
        )}
        role="status"
        aria-live="polite"
      >
        {isError ? (
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        ) : isBusy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        ) : (
          <span className="relative flex w-2 h-2 shrink-0">
            <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
          </span>
        )}
        <span className="truncate">{t(PHASE_LABEL_KEY[live.phase])}</span>
        {live.preview && isBusy ? (
          <span className="ml-auto shrink-0 text-[11px] text-[var(--placeholder)]">
            {t("chatFiles.liveShowingLast")}
          </span>
        ) : null}
      </div>

      {isError && live.error ? (
        <pre className="mx-4 sm:mx-5 mt-3 max-h-32 overflow-auto rounded-[8px] border border-red-500/30 bg-red-500/5 p-2.5 font-mono text-[11px] leading-relaxed text-red-300 whitespace-pre-wrap shrink-0">
          {live.error.slice(-2000)}
        </pre>
      ) : null}

      {live.preview ? (
        <div data-ask-selectable="true" className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <FilePreviewSurface key={live.preview.url} file={live.preview} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col px-4 sm:px-5 py-3 gap-2">
          <p className="text-[11.5px] font-medium text-[var(--muted)] shrink-0">
            {tail ? t("chatFiles.liveSourceTitle") : t("chatFiles.liveWaiting")}
          </p>
          {tail ? (
            <pre
              ref={sourceRef}
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
      )}
    </div>
  );
}
