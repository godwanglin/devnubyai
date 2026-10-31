"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Monitor, RotateCw, Smartphone } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import {
  CLEAR_EDIT_CHIPS_EVENT,
  dispatchAddEditChip,
  emitExternalTextSelection,
  REMOVE_EDIT_CHIP_EVENT,
} from "@/lib/files/preview-events";
import { useI18n } from "@/providers/i18n-provider";
import {
  BridgeRect,
  BridgeSelectionMessage,
  injectSelectionBridge,
} from "./html-selection-bridge";
import { findLineRangeInText } from "./preview-utils";
import { CopyCodeButton, RawCodeSurface } from "./raw-code-surface";
import { RequestEditsButton } from "./request-edits-button";
import { TextEditPopover } from "./text-edit-popover";

export interface HtmlFilePreviewProps {
  html: string;
  title: string;
  fileId?: string;
}

export function HtmlFilePreview({ html, title, fileId }: HtmlFilePreviewProps) {
  const { t } = useI18n();
  const bridgeToken = useId();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastRectRef = useRef<BridgeRect | null>(null);

  const [liveHtml, setLiveHtml] = useState<string | null>(null);
  const [prevHtml, setPrevHtml] = useState(html);
  if (prevHtml !== html) {
    setPrevHtml(html);
    setLiveHtml(null);
  }
  const currentHtml = liveHtml ?? html;

  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [reloadTick, setReloadTick] = useState(0);

  const [requestEditsActive, setRequestEditsActive] = useState(false);
  const [previewSelection, setPreviewSelection] = useState<{
    text: string;
    firstText?: string;
    lastText?: string;
    htmlSnippet?: string;
    tagName?: string;
    id?: string;
    className?: string;
    src?: string;
    top: number;
    left: number;
    visible?: boolean;
  } | null>(null);
  const [debugMode, setDebugMode] = useState(false);

  const bridgedSrcDoc = useMemo(
    () => injectSelectionBridge(currentHtml, bridgeToken),
    [currentHtml, bridgeToken]
  );

  const [prevReqActive, setPrevReqActive] = useState(requestEditsActive);
  if (prevReqActive !== requestEditsActive) {
    setPrevReqActive(requestEditsActive);
    if (!requestEditsActive) {
      setPreviewSelection(null);
    }
  }

  // Synchronize requestEdits state to the iframe bridge
  useEffect(() => {
    if (!requestEditsActive) {
      lastRectRef.current = null;
    }
    iframeRef.current?.contentWindow?.postMessage(
      { __devnubyReqEdits: requestEditsActive },
      "*"
    );
  }, [requestEditsActive]);

  const computePopoverPos = useCallback(
    (rect: BridgeRect): { top: number; left: number } | null => {
      const iframeEl = iframeRef.current;
      const containerEl = containerRef.current;
      if (!iframeEl || !containerEl) return null;

      const frameRect = iframeEl.getBoundingClientRect();
      const contRect = containerEl.getBoundingClientRect();

      const top =
        frameRect.top - contRect.top + containerEl.scrollTop + rect.y + rect.height + 8;
      const left = Math.max(
        12,
        Math.min(
          contRect.width - 430,
          frameRect.left - contRect.left + containerEl.scrollLeft + rect.x
        )
      );
      return { top, left };
    },
    []
  );

  // Listen to messages from the iframe bridge (selection & real-time scroll updates)
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      const data = e.data as BridgeSelectionMessage | null;
      if (!data || !data.rect) return;

      if (data.__devnubyEditSelect === bridgeToken) {
        lastRectRef.current = data.rect;
        const pos = computePopoverPos(data.rect);
        if (!pos) return;

        setPreviewSelection({
          text: data.text || "",
          firstText: data.firstText,
          lastText: data.lastText,
          htmlSnippet: data.htmlSnippet,
          tagName: data.tagName,
          id: data.id,
          src: data.src,
          className: data.className,
          top: pos.top,
          left: pos.left,
          visible: true,
        });
      } else if (data.__devnubyScrollUpdate === bridgeToken) {
        lastRectRef.current = data.rect;
        const pos = computePopoverPos(data.rect);
        if (!pos) return;

        setPreviewSelection((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            top: pos.top,
            left: pos.left,
            visible: data.visible !== false,
          };
        });
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [bridgeToken, computePopoverPos]);

  // Synchronize popover if the outer preview container is scrolled (e.g. in mobile viewport)
  useEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl) return;

    function handleContainerScroll() {
      if (!lastRectRef.current) return;
      const pos = computePopoverPos(lastRectRef.current);
      if (!pos) return;
      setPreviewSelection((prev) => (prev ? { ...prev, top: pos.top, left: pos.left } : null));
    }

    containerEl.addEventListener("scroll", handleContainerScroll, { passive: true });
    window.addEventListener("resize", handleContainerScroll, { passive: true });

    return () => {
      containerEl.removeEventListener("scroll", handleContainerScroll);
      window.removeEventListener("resize", handleContainerScroll);
    };
  }, [computePopoverPos]);

  // Listen to chip removals/clears from the composer to unpin elements in the iframe
  useEffect(() => {
    function onRemoveChip(e: Event) {
      const detail = (e as CustomEvent<{ id: string }>).detail;
      if (detail?.id) {
        iframeRef.current?.contentWindow?.postMessage(
          { __devnubyRemoveChip: detail.id },
          "*"
        );
      }
    }
    function onClearChips() {
      iframeRef.current?.contentWindow?.postMessage({ __devnubyClear: true }, "*");
    }
    window.addEventListener(REMOVE_EDIT_CHIP_EVENT, onRemoveChip);
    window.addEventListener(CLEAR_EDIT_CHIPS_EVENT, onClearChips);
    return () => {
      window.removeEventListener(REMOVE_EDIT_CHIP_EVENT, onRemoveChip);
      window.removeEventListener(CLEAR_EDIT_CHIPS_EVENT, onClearChips);
    };
  }, []);

  function handlePreviewEditSubmit(prompt: string) {
    if (!previewSelection) return;
    const lineRange = findLineRangeInText(currentHtml, previewSelection.text, {
      firstText: previewSelection.firstText,
      lastText: previewSelection.lastText,
      htmlSnippet: previewSelection.htmlSnippet,
      tagName: previewSelection.tagName,
      id: previewSelection.id,
      src: previewSelection.src,
      className: previewSelection.className,
    });

    if (debugMode) {
      const updated = currentHtml.replace(previewSelection.text, prompt);
      setLiveHtml(updated);
      setPreviewSelection(null);
      lastRectRef.current = null;
      iframeRef.current?.contentWindow?.postMessage({ __devnubyClear: true }, "*");
    } else {
      const chipId = `chip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      dispatchAddEditChip({
        id: chipId,
        fileId: fileId || "html-file",
        filename: title,
        selectedText: previewSelection.text,
        instruction: prompt || undefined,
        lineNumber: lineRange?.startLine,
        lineEndNumber:
          lineRange && lineRange.endLine !== lineRange.startLine
            ? lineRange.endLine
            : undefined,
        tagName: previewSelection.tagName,
        rect: lastRectRef.current || undefined,
      });

      iframeRef.current?.contentWindow?.postMessage(
        { __devnubyConfirmChip: chipId },
        "*"
      );
      setPreviewSelection(null);
      lastRectRef.current = null;
    }
  }

  const tabClass = (active: boolean) =>
    cn(
      "px-2.5 py-1 rounded-[6px] text-xs font-medium transition-colors cursor-pointer select-none",
      active
        ? "bg-[var(--accent-soft)] text-[var(--ink)]"
        : "text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)]"
    );

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {/* Sub-toolbar */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]/60 select-none shrink-0">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              emitExternalTextSelection(null);
              setTab("preview");
            }}
            className={tabClass(tab === "preview")}
          >
            {t("chatFiles.tabPreview")}
          </button>
          <button
            type="button"
            onClick={() => {
              emitExternalTextSelection(null);
              setTab("code");
            }}
            className={tabClass(tab === "code")}
          >
            {t("chatFiles.tabCode")}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {tab === "preview" ? (
            <>
              <Tooltip content={t("chatFiles.viewportDesktop")} side="bottom">
                <button
                  type="button"
                  onClick={() => {
                    emitExternalTextSelection(null);
                    setViewport("desktop");
                  }}
                  className={cn(
                    "grid place-items-center w-7 h-7 rounded-[6px] transition-colors cursor-pointer",
                    viewport === "desktop"
                      ? "bg-[var(--accent-soft)] text-[var(--ink)]"
                      : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                  )}
                  aria-label={t("chatFiles.viewportDesktop")}
                >
                  <Monitor className="w-3.5 h-3.5" />
                </button>
              </Tooltip>

              <Tooltip content={t("chatFiles.viewportMobile")} side="bottom">
                <button
                  type="button"
                  onClick={() => {
                    emitExternalTextSelection(null);
                    setViewport("mobile");
                  }}
                  className={cn(
                    "grid place-items-center w-7 h-7 rounded-[6px] transition-colors cursor-pointer",
                    viewport === "mobile"
                      ? "bg-[var(--accent-soft)] text-[var(--ink)]"
                      : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                  )}
                  aria-label={t("chatFiles.viewportMobile")}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                </button>
              </Tooltip>

              <Tooltip content={t("chatFiles.reloadPreview")} side="bottom" align="end">
                <button
                  type="button"
                  onClick={() => {
                    emitExternalTextSelection(null);
                    setReloadTick((n) => n + 1);
                  }}
                  className="grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                  aria-label={t("chatFiles.reloadPreview")}
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            </>
          ) : (
            <CopyCodeButton text={currentHtml} />
          )}

          <span className="w-px h-3.5 bg-[var(--border)] mx-0.5" aria-hidden="true" />

          {/* Request edits button */}
          <RequestEditsButton
            active={requestEditsActive}
            onClick={() => setRequestEditsActive((prev) => !prev)}
          />
        </div>
      </div>

      {/* Content Area */}
      {tab === "preview" ? (
        <div
          ref={containerRef}
          className={cn(
            "relative flex-1 min-h-0 flex justify-center bg-[var(--surface)]",
            viewport === "mobile" && "p-4 overflow-y-auto"
          )}
        >
          {/* SECURITY: Strictly NO `allow-same-origin` — runs in an opaque null origin */}
          <iframe
            ref={iframeRef}
            key={reloadTick}
            title={title}
            srcDoc={bridgedSrcDoc}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            className={cn(
              "bg-white border-0",
              viewport === "mobile"
                ? "w-[390px] max-w-full min-h-[680px] h-full rounded-[16px] border border-[var(--border)] shadow-md"
                : "w-full h-full"
            )}
          />

          {/* Popover for element selected in Preview mode — clamped inside preview container */}
          {previewSelection && previewSelection.visible !== false && (
            <TextEditPopover
              top={previewSelection.top}
              left={previewSelection.left}
              positionMode="absolute"
              badgeLabel={
                (() => {
                  const range = findLineRangeInText(currentHtml, previewSelection.text, {
                    firstText: previewSelection.firstText,
                    lastText: previewSelection.lastText,
                    htmlSnippet: previewSelection.htmlSnippet,
                    tagName: previewSelection.tagName,
                    id: previewSelection.id,
                    src: previewSelection.src,
                    className: previewSelection.className,
                  });
                  if (range) {
                    const lineStr =
                      range.startLine === range.endLine
                        ? `Line ${range.startLine}`
                        : `Lines ${range.startLine}-${range.endLine}`;
                    return previewSelection.tagName && previewSelection.tagName !== "area"
                      ? `<${previewSelection.tagName}> · ${lineStr}`
                      : lineStr;
                  }
                  return previewSelection.tagName ? `<${previewSelection.tagName}>` : undefined;
                })()
              }
              debugMode={debugMode}
              onToggleDebugMode={() => setDebugMode((v) => !v)}
              onSubmit={handlePreviewEditSubmit}
              onCancel={() => {
                setPreviewSelection(null);
                lastRectRef.current = null;
                iframeRef.current?.contentWindow?.postMessage({ __devnubyClear: true }, "*");
              }}
            />
          )}
        </div>
      ) : (
        <RawCodeSurface
          code={currentHtml}
          language="html"
          fileId={fileId}
          filename={title}
          requestEditsActive={requestEditsActive}
          onRequestEditsClose={() => setRequestEditsActive(false)}
          onLiveCodeChange={setLiveHtml}
        />
      )}
    </div>
  );
}
