"use client";

import React, { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { cn } from "@/lib/cn";
import { getHighlightLanguage, type FilePreviewKind } from "@/lib/files/policy";
import { useI18n } from "@/providers/i18n-provider";
import { wrapInCodeFence } from "./preview-utils";
import { CopyCodeButton, RawCodeSurface } from "./raw-code-surface";
import { RequestEditsButton } from "./request-edits-button";
import { DomRequestEditLayer, type DomSelectedArea } from "./dom-request-edit-layer";

export interface CodeAndTextPreviewProps {
  kind: Extract<
    FilePreviewKind,
    "markdown" | "svg" | "mermaid" | "json" | "code" | "text"
  >;
  extension: string;
  content: string;
  highlightTarget?: {
    text: string;
    charOffset?: number;
  };
  fileId?: string;
  title?: string;
}

function toSafeSvgDataUrl(svg: string): string {
  const withNs = /<svg[^>]*\sxmlns=/i.test(svg)
    ? svg
    : svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withNs)}`;
}

export function wrapHighlight(content: string, target?: { text?: string; charOffset?: number }): string {
  if (!content || !target || !target.text) return content;
  const needle = target.text.trim();
  if (!needle || needle.length < 3) return content;
  const idx = content.indexOf(needle);
  if (idx === -1) return content;
  const before = content.slice(0, idx);
  const match = content.slice(idx, idx + needle.length);
  const after = content.slice(idx + needle.length);
  return `${before}<mark class="ai-highlight">${match}</mark>${after}`;
}

export function CodeAndTextPreview({
  kind,
  extension,
  content,
  highlightTarget,
  fileId,
  title,
}: CodeAndTextPreviewProps) {
  const { t } = useI18n();
  const [liveOverride, setLiveOverride] = useState<string | null>(null);
  const [prevContent, setPrevContent] = useState(content);
  if (prevContent !== content) {
    setPrevContent(content);
    setLiveOverride(null);
  }
  const currentContent = liveOverride ?? content;

  const [richTab, setRichTab] = useState<"preview" | "code">("preview");
  const [jsonTab, setJsonTab] = useState<"tree" | "code">("tree");

  const [requestEditsActive, setRequestEditsActive] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);

  function handleDomEditSubmit(prompt: string, selectedArea: DomSelectedArea) {
    if (debugMode) {
      const updated = currentContent.replace(selectedArea.text, prompt);
      setLiveOverride(updated);
    }
  }

  const parsedJson = useMemo(() => {
    if (kind !== "json") return { ok: false as const, value: null, pretty: currentContent };
    try {
      const value = JSON.parse(currentContent);
      return {
        ok: true as const,
        value,
        pretty: JSON.stringify(value, null, 2),
      };
    } catch {
      return { ok: false as const, value: null, pretty: currentContent };
    }
  }, [kind, currentContent]);

  const tabClass = (active: boolean) =>
    cn(
      "px-2.5 py-1 rounded-[6px] text-xs font-medium transition-colors cursor-pointer select-none",
      active
        ? "bg-[var(--accent-soft)] text-[var(--ink)]"
        : "text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)]"
    );

  // 1. Markdown (.md / .markdown) with Preview | Code + Request edits at far right
  if (kind === "markdown") {
    return (
      <div className="relative flex flex-col h-full min-h-0">
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]/60 select-none shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setRichTab("preview")}
              className={tabClass(richTab === "preview")}
            >
              {t("chatFiles.tabPreview")}
            </button>
            <button
              type="button"
              onClick={() => setRichTab("code")}
              className={tabClass(richTab === "code")}
            >
              {t("chatFiles.tabCode")}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <CopyCodeButton text={currentContent} />
            <span className="w-px h-3.5 bg-[var(--border)] mx-0.5" aria-hidden="true" />
            <RequestEditsButton
              active={requestEditsActive}
              onClick={() => setRequestEditsActive((prev) => !prev)}
            />
          </div>
        </div>

        {richTab === "preview" ? (
          <div
            ref={previewContainerRef}
            className={cn(
              "relative flex-1 min-h-0 overflow-y-auto px-5 py-4",
              requestEditsActive ? "cursor-crosshair select-none" : "select-text"
            )}
          >
            <MarkdownRenderer content={wrapHighlight(currentContent, highlightTarget)} />
            <DomRequestEditLayer
              containerRef={previewContainerRef}
              active={requestEditsActive}
              content={currentContent}
              fileId={fileId}
              filename={title || `file.${extension}`}
              debugMode={debugMode}
              onToggleDebugMode={() => setDebugMode((v) => !v)}
              onSubmitEdit={handleDomEditSubmit}
              onCancel={() => setRequestEditsActive(false)}
            />
          </div>
        ) : (
          <RawCodeSurface
            code={currentContent}
            language="markdown"
            fileId={fileId}
            filename={title || `file.${extension}`}
            requestEditsActive={requestEditsActive}
            onRequestEditsClose={() => setRequestEditsActive(false)}
            onLiveCodeChange={setLiveOverride}
          />
        )}
      </div>
    );
  }

  // 2. SVG & Mermaid diagrams with unified Preview | Code + Request edits at far right
  if (kind === "svg" || kind === "mermaid") {
    return (
      <div className="relative flex flex-col h-full min-h-0">
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]/60 select-none shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setRichTab("preview")}
              className={tabClass(richTab === "preview")}
            >
              {t("chatFiles.tabPreview")}
            </button>
            <button
              type="button"
              onClick={() => setRichTab("code")}
              className={tabClass(richTab === "code")}
            >
              {t("chatFiles.tabCode")}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <CopyCodeButton text={currentContent} />
            <span className="w-px h-3.5 bg-[var(--border)] mx-0.5" aria-hidden="true" />
            <RequestEditsButton
              active={requestEditsActive}
              onClick={() => setRequestEditsActive((prev) => !prev)}
            />
          </div>
        </div>

        {richTab === "preview" ? (
          kind === "svg" ? (
            <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-6 bg-[var(--surface)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={toSafeSvgDataUrl(currentContent)}
                alt="SVG Preview"
                className="max-w-full max-h-full object-contain rounded-[8px]"
              />
            </div>
          ) : (
            <div
              ref={previewContainerRef}
              className={cn(
                "relative flex-1 min-h-0 overflow-y-auto px-4 py-3",
                requestEditsActive ? "cursor-crosshair select-none" : "select-text"
              )}
            >
              <MarkdownRenderer
                content={wrapInCodeFence(currentContent, "mermaid")}
                className="[&>div]:!my-0"
              />
              <DomRequestEditLayer
                containerRef={previewContainerRef}
                active={requestEditsActive}
                content={currentContent}
                fileId={fileId}
                filename={title || `file.${extension}`}
                debugMode={debugMode}
                onToggleDebugMode={() => setDebugMode((v) => !v)}
                onSubmitEdit={handleDomEditSubmit}
                onCancel={() => setRequestEditsActive(false)}
              />
            </div>
          )
        ) : (
          <RawCodeSurface
            code={currentContent}
            language={kind === "svg" ? "xml" : "plaintext"}
            fileId={fileId}
            filename={title || `file.${extension}`}
            requestEditsActive={requestEditsActive}
            onRequestEditsClose={() => setRequestEditsActive(false)}
            onLiveCodeChange={setLiveOverride}
          />
        )}
      </div>
    );
  }

  // 3. JSON with Tree | Code + Request edits at far right
  if (kind === "json" && parsedJson.ok) {
    return (
      <div className="relative flex flex-col h-full min-h-0">
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]/60 select-none shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setJsonTab("tree")}
              className={tabClass(jsonTab === "tree")}
            >
              {t("chatFiles.tabTree")}
            </button>
            <button
              type="button"
              onClick={() => setJsonTab("code")}
              className={tabClass(jsonTab === "code")}
            >
              {t("chatFiles.tabCode")}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <CopyCodeButton text={parsedJson.pretty} />
            <span className="w-px h-3.5 bg-[var(--border)] mx-0.5" aria-hidden="true" />
            <RequestEditsButton
              active={requestEditsActive}
              onClick={() => setRequestEditsActive((prev) => !prev)}
            />
          </div>
        </div>

        {jsonTab === "tree" ? (
          <div
            ref={previewContainerRef}
            className={cn(
              "relative flex-1 min-h-0 overflow-y-auto px-4 py-3",
              requestEditsActive ? "cursor-crosshair select-none" : "select-text"
            )}
          >
            <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3.5 font-mono text-[12px] leading-relaxed overflow-x-auto">
              <JsonTreeNode value={parsedJson.value} depth={0} />
            </div>
            <DomRequestEditLayer
              containerRef={previewContainerRef}
              active={requestEditsActive}
              content={parsedJson.pretty}
              fileId={fileId}
              filename={title || `file.${extension}`}
              debugMode={debugMode}
              onToggleDebugMode={() => setDebugMode((v) => !v)}
              onSubmitEdit={handleDomEditSubmit}
              onCancel={() => setRequestEditsActive(false)}
            />
          </div>
        ) : (
          <RawCodeSurface
            code={parsedJson.pretty}
            language="json"
            fileId={fileId}
            filename={title || `file.${extension}`}
            requestEditsActive={requestEditsActive}
            onRequestEditsClose={() => setRequestEditsActive(false)}
            onLiveCodeChange={setLiveOverride}
          />
        )}
      </div>
    );
  }

  // 4. Pure Source Code & Plain Text — Code sub-toolbar with Request edits at far right
  const lang = getHighlightLanguage(extension);
  return (
    <div className="relative flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]/60 select-none shrink-0">
        <span className="px-2.5 py-1 rounded-[6px] text-xs font-medium bg-[var(--accent-soft)] text-[var(--ink)]">
          {t("chatFiles.tabCode")}
        </span>
        <div className="flex items-center gap-1.5">
          <CopyCodeButton text={currentContent} />
          <span className="w-px h-3.5 bg-[var(--border)] mx-0.5" aria-hidden="true" />
          <RequestEditsButton
            active={requestEditsActive}
            onClick={() => setRequestEditsActive((prev) => !prev)}
          />
        </div>
      </div>
      <RawCodeSurface
        code={currentContent}
        language={lang}
        fileId={fileId}
        filename={title || `file.${extension}`}
        requestEditsActive={requestEditsActive}
        onRequestEditsClose={() => setRequestEditsActive(false)}
        onLiveCodeChange={setLiveOverride}
      />
    </div>
  );
}

function JsonTreeNode({
  label,
  value,
  depth,
}: {
  label?: string;
  value: unknown;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 2);

  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === "object" && !isArray;

  if (!isArray && !isObject) {
    return (
      <div className="py-0.5 flex items-baseline gap-1.5">
        {label !== undefined ? (
          <span className="text-[var(--ink)] font-medium shrink-0">&quot;{label}&quot;:</span>
        ) : null}
        <span
          className={cn(
            typeof value === "string"
              ? "text-[var(--muted)] break-all"
              : "text-[var(--ink)]"
          )}
        >
          {typeof value === "string" ? JSON.stringify(value) : String(value)}
        </span>
      </div>
    );
  }

  const entries: Array<[string, unknown]> = isArray
    ? (value as unknown[]).slice(0, 300).map((item, idx) => [String(idx), item])
    : Object.entries(value as Record<string, unknown>).slice(0, 300);

  const totalCount = isArray
    ? (value as unknown[]).length
    : Object.keys(value as Record<string, unknown>).length;
  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";

  return (
    <div className="py-0.5">
      <div
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 cursor-pointer hover:text-[var(--ink)] text-[var(--muted)] select-none"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0" />
        )}
        {label !== undefined ? (
          <span className="text-[var(--ink)] font-medium">&quot;{label}&quot;:</span>
        ) : null}
        <span className="text-[var(--muted)] font-mono text-[11px]">
          {openBracket}
          {!open ? ` ... ${totalCount} item ` : ""}
          {!open ? closeBracket : ""}
        </span>
      </div>

      {open && (
        <div className="pl-4 border-l border-[var(--border)] ml-1.5 my-0.5 space-y-0.5">
          {entries.map(([childKey, childVal]) => (
            <JsonTreeNode
              key={childKey}
              label={isArray ? undefined : childKey}
              value={childVal}
              depth={depth + 1}
            />
          ))}
          {totalCount > entries.length ? (
            <div className="text-[11px] text-[var(--muted)] italic py-0.5">
              ... +{totalCount - entries.length} item lagi
            </div>
          ) : null}
          <div className="text-[var(--muted)] font-mono text-[11px]">{closeBracket}</div>
        </div>
      )}
    </div>
  );
}
