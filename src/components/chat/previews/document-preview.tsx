"use client";

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import { DomRequestEditLayer, type DomSelectedArea } from "./dom-request-edit-layer";
import { PdfFilePreview } from "./pdf-file-preview";
import { RequestEditsButton } from "./request-edits-button";

export interface DocumentPreviewProps {
  kind: "pdf" | "docx";
  bytes: ArrayBuffer;
  title: string;
  downloadUrl: string;
  fileId?: string;
  initialSearchQuery?: string;
}

const ALLOWED_DOCX_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "sub",
  "sup",
  "blockquote",
  "pre",
  "code",
  "br",
  "hr",
  "a",
  "img",
  "span",
  "div",
]);

function isSafeUrl(raw: string, allowDataImage: boolean): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (allowDataImage && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(trimmed)) {
    return true;
  }
  try {
    const parsed = new URL(trimmed, "https://example.invalid");
    return parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

/**
 * Strictly allowlists Mammoth HTML output so it can be rendered directly in the DOM
 * with zero script/XSS surface and full native text selection for "Tanya Devnuby".
 */
function sanitizeDocxHtml(rawHtml: string): string {
  if (typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");

  function cleanNode(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || "");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "iframe" || tag === "object") {
      return null;
    }

    const outTag = ALLOWED_DOCX_TAGS.has(tag) ? tag : "span";
    const cleanEl = document.createElement(outTag);

    if (outTag === "a") {
      const href = el.getAttribute("href") || "";
      if (isSafeUrl(href, false)) {
        cleanEl.setAttribute("href", href);
        cleanEl.setAttribute("target", "_blank");
        cleanEl.setAttribute("rel", "noopener noreferrer");
      }
    } else if (outTag === "img") {
      const src = el.getAttribute("src") || "";
      if (!isSafeUrl(src, true)) return null;
      cleanEl.setAttribute("src", src);
      const alt = el.getAttribute("alt");
      if (alt) cleanEl.setAttribute("alt", alt);
    } else if (outTag === "td" || outTag === "th") {
      const colspan = el.getAttribute("colspan");
      const rowspan = el.getAttribute("rowspan");
      if (colspan && /^\d+$/.test(colspan)) cleanEl.setAttribute("colspan", colspan);
      if (rowspan && /^\d+$/.test(rowspan)) cleanEl.setAttribute("rowspan", rowspan);
    }

    for (const child of Array.from(el.childNodes)) {
      const cleaned = cleanNode(child);
      if (cleaned) cleanEl.appendChild(cleaned);
    }
    return cleanEl;
  }

  const wrapper = document.createElement("div");
  for (const child of Array.from(doc.body.childNodes)) {
    const cleaned = cleanNode(child);
    if (cleaned) wrapper.appendChild(cleaned);
  }
  return wrapper.innerHTML;
}

export function DocumentPreview({
  kind,
  bytes,
  title,
  fileId,
  initialSearchQuery,
}: DocumentPreviewProps) {
  const { t } = useI18n();

  if (kind === "pdf") {
    return (
      <PdfFilePreview
        bytes={bytes}
        title={title}
        fileId={fileId}
        initialSearchQuery={initialSearchQuery}
      />
    );
  }

  return (
    <DocxViewer
      bytes={bytes}
      title={title}
      fileId={fileId}
      loadingLabel={t("chatFiles.previewLoading")}
      errorLabel={t("chatFiles.previewError")}
    />
  );
}

function DocxViewer({
  bytes,
  title,
  fileId,
  loadingLabel,
  errorLabel,
}: {
  bytes: ArrayBuffer;
  title: string;
  fileId?: string;
  loadingLabel: string;
  errorLabel: string;
}) {
  const [safeHtml, setSafeHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [requestEditsActive, setRequestEditsActive] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const mammoth = await import("mammoth/mammoth.browser");
        const result = await mammoth.convertToHtml({ arrayBuffer: bytes.slice(0) });
        if (active) {
          setSafeHtml(sanitizeDocxHtml(result.value || "<p></p>"));
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [bytes]);

  function handleDomEditSubmit(prompt: string, selectedArea: DomSelectedArea) {
    if (debugMode && safeHtml) {
      setSafeHtml(safeHtml.replace(selectedArea.text, prompt));
    }
  }

  if (failed) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-xs text-[var(--muted)] text-center">
        {errorLabel}
      </div>
    );
  }

  if (safeHtml === null) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-xs text-[var(--muted)]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        <span>{loadingLabel}</span>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {/* Sub-toolbar */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]/60 select-none shrink-0">
        <span className="px-2.5 py-1 rounded-[6px] text-xs font-medium bg-[var(--accent-soft)] text-[var(--ink)]">
          DOCX
        </span>
        <RequestEditsButton
          active={requestEditsActive}
          onClick={() => setRequestEditsActive((prev) => !prev)}
        />
      </div>

      <div
        ref={containerRef}
        aria-label={title}
        className={cn(
          "relative flex-1 min-h-0 overflow-y-auto px-6 py-6 bg-[var(--panel)]",
          requestEditsActive ? "cursor-crosshair select-none" : "select-text"
        )}
      >
        <div
          className="prose-chat max-w-[740px] mx-auto text-[14.5px] leading-relaxed text-[var(--ink)] [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-[var(--border)] [&_th]:bg-[var(--surface)] [&_th]:px-3 [&_th]:py-2 [&_td]:border [&_td]:border-[var(--border)] [&_td]:px-3 [&_td]:py-2 [&_img]:rounded-[8px]"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />

        <DomRequestEditLayer
          containerRef={containerRef}
          active={requestEditsActive}
          content={safeHtml || ""}
          fileId={fileId}
          filename={title}
          debugMode={debugMode}
          onToggleDebugMode={() => setDebugMode((v) => !v)}
          onSubmitEdit={handleDomEditSubmit}
          onCancel={() => setRequestEditsActive(false)}
        />
      </div>
    </div>
  );
}
