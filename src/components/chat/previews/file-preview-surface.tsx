"use client";

import React, { useEffect, useState } from "react";
import { Download, FileQuestion, Loader2 } from "lucide-react";
import { classifyPreviewKind, formatFileSize } from "@/lib/files/policy";
import { useI18n } from "@/providers/i18n-provider";
import type { SessionFileItem } from "@/types";
import { CodeAndTextPreview } from "./code-and-text-preview";
import { DocumentPreview } from "./document-preview";
import { HtmlFilePreview } from "./html-file-preview";
import { SpreadsheetPreview } from "./spreadsheet-preview";
import { SmartImage } from "@/components/ui/smart-image";

export interface FilePreviewSurfaceProps {
  file: SessionFileItem;
  highlightTarget?: {
    text: string;
    charOffset?: number;
  };
}

type LoadedPayload =
  | { status: "loading" }
  | { status: "error" }
  | { status: "text"; text: string }
  | { status: "binary"; bytes: ArrayBuffer };

export function FilePreviewSurface({
  file,
  highlightTarget,
}: FilePreviewSurfaceProps) {
  const { t } = useI18n();
  const ext = file.extension.toLowerCase();
  const kind = classifyPreviewKind(file.displayName || ext, file.mimeType);

  const needsBinary =
    kind === "pdf" ||
    kind === "docx" ||
    (kind === "spreadsheet" && (ext === "xlsx" || ext === "xls"));

  const [payload, setPayload] = useState<LoadedPayload>({ status: "loading" });

  useEffect(() => {
    if (kind === "unsupported" || kind === "image") return;

    let active = true;
    const controller = new AbortController();

    (async () => {
      await Promise.resolve();
      if (!active) return;
      setPayload({ status: "loading" });

      try {
        const res = await fetch(file.url, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        if (needsBinary) {
          const bytes = await res.arrayBuffer();
          if (active) setPayload({ status: "binary", bytes });
        } else {
          const text = await res.text();
          if (active) setPayload({ status: "text", text });
        }
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        if (active) setPayload({ status: "error" });
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [file.url, kind, needsBinary]);

  if (kind === "unsupported") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-full bg-[var(--hover)] text-[var(--muted)]">
          <FileQuestion className="w-5 h-5" />
        </span>
        <div className="space-y-1 max-w-xs">
          <p className="text-sm font-medium text-[var(--ink)]">{file.displayName}</p>
          <p className="text-xs text-[var(--muted)]">
            {file.extension.toUpperCase()} · {formatFileSize(file.sizeBytes)}
          </p>
          <p className="text-xs text-[var(--muted)] pt-1 leading-relaxed">
            {t("chatFiles.unsupportedPreview")}
          </p>
        </div>
        <a
          href={file.url}
          download={file.displayName}
          className="mt-1 inline-flex items-center gap-2 h-8 px-3.5 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-text)] hover:bg-[var(--accent-hover)] text-xs font-medium transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          <span>{t("chatFiles.download")}</span>
        </a>
      </div>
    );
  }

  if (kind === "image") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-auto">
        <SmartImage
          src={file.url}
          alt={file.displayName}
          loaderSize="lg"
          showLabel
          containerClassName="max-w-full max-h-[80vh] flex items-center justify-center rounded-xl"
          imgClassName="max-w-full max-h-[80vh] object-contain rounded-xl shadow-xl border border-[var(--border)]"
        />
      </div>
    );
  }

  if (payload.status === "loading") {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-xs text-[var(--muted)]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        <span>{t("chatFiles.previewLoading")}</span>
      </div>
    );
  }

  if (payload.status === "error") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3">
        <p className="text-xs text-[var(--muted)]">{t("chatFiles.previewError")}</p>
        <a
          href={file.url}
          download={file.displayName}
          className="inline-flex items-center gap-2 h-8 px-3.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--hover)] text-xs font-medium text-[var(--ink)] transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          <span>{t("chatFiles.download")}</span>
        </a>
      </div>
    );
  }

  if (kind === "html" && payload.status === "text") {
    return (
      <HtmlFilePreview
        html={payload.text}
        title={file.displayName}
        fileId={file.id}
      />
    );
  }

  if (kind === "spreadsheet") {
    return (
      <SpreadsheetPreview
        extension={ext}
        textContent={payload.status === "text" ? payload.text : undefined}
        binaryContent={payload.status === "binary" ? payload.bytes : undefined}
        fileId={file.id}
        filename={file.displayName}
      />
    );
  }

  if ((kind === "pdf" || kind === "docx") && payload.status === "binary") {
    return (
      <DocumentPreview
        kind={kind}
        bytes={payload.bytes}
        title={file.displayName}
        downloadUrl={file.url}
        fileId={file.id}
        initialSearchQuery={highlightTarget?.text}
      />
    );
  }

  if (
    payload.status === "text" &&
    (kind === "markdown" ||
      kind === "svg" ||
      kind === "mermaid" ||
      kind === "json" ||
      kind === "code" ||
      kind === "text")
  ) {
    return (
      <CodeAndTextPreview
        kind={kind}
        extension={ext}
        content={payload.text}
        highlightTarget={highlightTarget}
        fileId={file.id}
        title={file.displayName}
      />
    );
  }

  return null;
}
