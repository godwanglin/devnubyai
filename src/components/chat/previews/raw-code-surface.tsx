"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Root, RootContent } from "hast";
import { common, createLowlight } from "lowlight";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import { dispatchAddEditChip } from "@/lib/files/preview-events";
import { useI18n } from "@/providers/i18n-provider";
import { TextEditPopover } from "./text-edit-popover";

const lowlight = createLowlight(common);

const LANGUAGE_ALIASES: Record<string, string> = {
  html: "xml",
  svg: "xml",
  tsx: "typescript",
  jsx: "javascript",
  sh: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  mmd: "plaintext",
  mermaid: "plaintext",
  csv: "plaintext",
  tsv: "plaintext",
  txt: "plaintext",
  text: "plaintext",
};

const MAX_HIGHLIGHT_CHARS = 120_000;

function resolveGrammar(rawLanguage: string): string | null {
  const lower = rawLanguage.trim().toLowerCase();
  const mapped = LANGUAGE_ALIASES[lower] || lower;
  if (!mapped || mapped === "plaintext") return null;
  return lowlight.registered(mapped) ? mapped : null;
}

/**
 * Walks a `lowlight` HAST tree and splits tokens across `\n` boundaries so every
 * logical line preserves multi-line comment/string `<span class="hljs-...">` classes.
 */
function hastToLines(root: Root): React.ReactNode[][] {
  const lines: React.ReactNode[][] = [[]];
  const classStack: string[] = [];
  let keyCounter = 0;

  function visit(node: RootContent) {
    if (node.type === "text") {
      const segments = node.value.split("\n");
      for (let i = 0; i < segments.length; i++) {
        if (i > 0) {
          lines.push([]);
        }
        const chunk = segments[i];
        if (!chunk) continue;

        if (classStack.length === 0) {
          lines[lines.length - 1].push(chunk);
        } else {
          lines[lines.length - 1].push(
            <span key={keyCounter++} className={classStack.join(" ")}>
              {chunk}
            </span>
          );
        }
      }
      return;
    }

    if (node.type === "element") {
      const rawCls = node.properties?.className;
      const cls = Array.isArray(rawCls)
        ? rawCls.join(" ")
        : typeof rawCls === "string"
          ? rawCls
          : "";
      if (cls) classStack.push(cls);
      for (const child of node.children) {
        visit(child as RootContent);
      }
      if (cls) classStack.pop();
    }
  }

  for (const child of root.children) {
    visit(child);
  }
  return lines;
}

export function CopyCodeButton({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore clipboard permission errors
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? t("message.copied") : t("message.copyCode")}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)] transition-colors cursor-pointer select-none shrink-0",
        copied && "text-[var(--ink)] bg-[var(--accent-soft)]",
        className
      )}
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 shrink-0" />
      ) : (
        <Copy className="w-3.5 h-3.5 shrink-0" />
      )}
      <span>{copied ? t("message.copied") : t("message.copyCode")}</span>
    </button>
  );
}

export interface RawCodeSurfaceProps {
  code: string;
  language?: string;
  fileId?: string;
  filename?: string;
  requestEditsActive?: boolean;
  onRequestEditsClose?: () => void;
  onLiveCodeChange?: (newCode: string) => void;
}

interface LineRange {
  start: number;
  end: number;
}

/**
 * Full-bleed IDE-style raw code viewer with right-aligned non-selectable line numbers,
 * continuous gutter divider, multi-line syntax highlighting, and clean text selection.
 * Also supports interactive line-based Request Edits when `requestEditsActive` is enabled.
 */
export function RawCodeSurface({
  code,
  language = "plaintext",
  fileId,
  filename,
  requestEditsActive = false,
  onLiveCodeChange,
}: RawCodeSurfaceProps) {
  const normalized = useMemo(
    () => code.replace(/\r\n/g, "\n").replace(/\n$/, ""),
    [code]
  );

  const lines = useMemo<React.ReactNode[][]>(() => {
    if (!normalized) return [[]];
    if (normalized.length > MAX_HIGHLIGHT_CHARS) {
      return normalized.split("\n").map((line) => (line ? [line] : []));
    }
    const grammar = resolveGrammar(language);
    if (!grammar) {
      return normalized.split("\n").map((line) => (line ? [line] : []));
    }
    try {
      const root = lowlight.highlight(grammar, normalized);
      return hastToLines(root);
    } catch {
      return normalized.split("\n").map((line) => (line ? [line] : []));
    }
  }, [normalized, language]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineElementsRef = useRef<Map<number, HTMLDivElement>>(new Map());

  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const [selectedRange, setSelectedRange] = useState<LineRange | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  // Clear selection if requestEdits becomes inactive
  const [prevRequestEditsActive, setPrevRequestEditsActive] = useState(requestEditsActive);
  if (prevRequestEditsActive !== requestEditsActive) {
    setPrevRequestEditsActive(requestEditsActive);
    if (!requestEditsActive) {
      setSelectedRange(null);
      setPopoverPos(null);
      setHoverLine(null);
    }
  }

  const calculatePopoverPosition = useCallback((range: LineRange) => {
    const endEl = lineElementsRef.current.get(range.end);
    const container = containerRef.current;
    if (!endEl || !container) return;

    const top = endEl.offsetTop + endEl.offsetHeight + 6;
    const left = Math.max(16, Math.min(container.clientWidth - 430, 60));
    setPopoverPos({ top, left });
  }, []);

  const handleLineMouseDown = useCallback(
    (lineNum: number) => {
      if (!requestEditsActive) return;
      setIsDragging(true);
      setDragFrom(lineNum);
      setSelectedRange({ start: lineNum, end: lineNum });
      setPopoverPos(null);
    },
    [requestEditsActive]
  );

  const handleLineMouseEnter = useCallback(
    (lineNum: number) => {
      if (!requestEditsActive) return;
      setHoverLine(lineNum);
      if (isDragging && dragFrom !== null) {
        setSelectedRange({
          start: Math.min(dragFrom, lineNum),
          end: Math.max(dragFrom, lineNum),
        });
      }
    },
    [requestEditsActive, isDragging, dragFrom]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    setDragFrom(null);
    if (selectedRange) {
      calculatePopoverPosition(selectedRange);
    }
  }, [isDragging, selectedRange, calculatePopoverPosition]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mouseup", handleMouseUp);
      return () => window.removeEventListener("mouseup", handleMouseUp);
    }
  }, [isDragging, handleMouseUp]);

  function handleSubmitEdit(prompt: string) {
    if (!selectedRange) return;
    const rawLines = normalized.split("\n");
    const selectedText = rawLines
      .slice(selectedRange.start - 1, selectedRange.end)
      .join("\n");

    if (debugMode) {
      const before = rawLines.slice(0, selectedRange.start - 1);
      const after = rawLines.slice(selectedRange.end);
      const updatedCode = [...before, prompt, ...after].join("\n");
      onLiveCodeChange?.(updatedCode);
      setSelectedRange(null);
      setPopoverPos(null);
    } else {
      const chipId = `chip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      dispatchAddEditChip({
        fileId: fileId || "code-file",
        filename: filename || "code",
        selectedText,
        instruction: prompt || undefined,
        lineNumber: selectedRange.start,
        lineEndNumber:
          selectedRange.end !== selectedRange.start ? selectedRange.end : undefined,
        id: chipId,
      });
      setSelectedRange(null);
      setPopoverPos(null);
    }
  }

  const wideGutter = lines.length >= 1000;

  return (
    <div
      ref={containerRef}
      onMouseLeave={() => setHoverLine(null)}
      className={cn(
        "relative flex-1 min-h-0 overflow-auto bg-[#0c0c0e] text-[#e2e8f0] font-mono text-[13px] leading-[1.65]",
        requestEditsActive && "cursor-crosshair select-none"
      )}
    >
      <div className="relative min-w-full pb-16">
        {lines.map((lineNodes, idx) => {
          const lineNum = idx + 1;
          const isFirst = idx === 0;
          const isLast = idx === lines.length - 1;

          const isSelected =
            selectedRange !== null &&
            lineNum >= selectedRange.start &&
            lineNum <= selectedRange.end;
          const isStartLine = selectedRange?.start === lineNum;
          const isEndLine = selectedRange?.end === lineNum;
          const isHovered =
            requestEditsActive &&
            !selectedRange &&
            hoverLine === lineNum;

          return (
            <div
              key={lineNum}
              ref={(el) => {
                if (el) lineElementsRef.current.set(lineNum, el);
                else lineElementsRef.current.delete(lineNum);
              }}
              onMouseDown={() => handleLineMouseDown(lineNum)}
              onMouseEnter={() => handleLineMouseEnter(lineNum)}
              className={cn(
                "relative grid transition-colors",
                wideGutter ? "grid-cols-[3.75rem_1fr]" : "grid-cols-[3.1rem_1fr]",
                !requestEditsActive && "hover:bg-white/[0.03]",
                isHovered && "bg-sky-500/10 border-l-2 border-[#38bdf8]",
                isSelected && "bg-sky-500/15 border-l-2 border-r-2 border-[#38bdf8]",
                isSelected && isStartLine && "border-t-2 border-[#38bdf8]",
                isSelected && isEndLine && "border-b-2 border-[#38bdf8]"
              )}
            >
              {/* Badge for selected range on first line */}
              {isSelected && isStartLine && (
                <div className="absolute right-3 top-1 z-10 pointer-events-none">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-blue-500 text-white shadow-md">
                    {selectedRange.start === selectedRange.end
                      ? `Line ${selectedRange.start}`
                      : `Lines ${selectedRange.start}-${selectedRange.end}`}
                  </span>
                </div>
              )}

              <span
                aria-hidden="true"
                className={cn(
                  "select-none pr-3 pl-2 text-right text-[12px] tabular-nums",
                  isSelected
                    ? "text-sky-300 font-semibold border-r-2 border-[#38bdf8]"
                    : "text-[#6e7681] border-r border-white/[0.09]",
                  isFirst && "pt-3",
                  isLast && "pb-4"
                )}
              >
                {lineNum}
              </span>

              <span
                className={cn(
                  "pl-4 pr-5 whitespace-pre-wrap break-words min-w-0",
                  requestEditsActive ? "select-none" : "select-text",
                  isFirst && "pt-3",
                  isLast && "pb-4"
                )}
              >
                {lineNodes.length > 0 ? lineNodes : "\u200B"}
              </span>
            </div>
          );
        })}

        {/* Floating popover positioned below selection */}
        {selectedRange && popoverPos && (
          <TextEditPopover
            top={popoverPos.top}
            left={popoverPos.left}
            badgeLabel={
              selectedRange.start === selectedRange.end
                ? `Line ${selectedRange.start}`
                : `Lines ${selectedRange.start}-${selectedRange.end}`
            }
            debugMode={debugMode}
            onToggleDebugMode={() => setDebugMode((v) => !v)}
            onSubmit={handleSubmitEdit}
            onCancel={() => {
              setSelectedRange(null);
              setPopoverPos(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
