"use client";

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Edit, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  AI_EDIT_REQUEST_EVENT,
  type AIEditRequestPayload,
} from "@/lib/files/preview-events";
import { useI18n } from "@/providers/i18n-provider";

const emptySubscribe = () => () => {};
const getSnapshot = () => true;

const MAX_INSTRUCTION_CHARS = 1000;
const MAX_SELECTED_CHARS = 2000;

interface InlineEditToolbarProps {
  /** File being previewed in the side panel */
  fileId?: string | null;
  filename?: string | null;
}

interface SelectionState {
  text: string;
  top: number;
  left: number;
  lineNumber?: number;
}

export function InlineEditToolbar({
  fileId,
  filename,
}: InlineEditToolbarProps) {
  const { t } = useI18n();
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [undoFileId, setUndoFileId] = useState<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const mounted = useSyncExternalStore(emptySubscribe, getSnapshot, () => false);

  const clampPosition = useCallback((rawTop: number, rawLeft: number) => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    return {
      top: Math.max(10, rawTop - 44),
      left: Math.max(84, Math.min(vw - 84, rawLeft)),
    };
  }, []);

  /**
   * Estimates the 1-based line number of a DOM selection by counting
   * preceding newlines in the containing text node's ancestor text.
   */
  function estimateLineNumber(range: Range): number | undefined {
    try {
      const node = range.startContainer;
      let text = "";
      if (node.nodeType === Node.TEXT_NODE) {
        text = node.textContent ?? "";
      } else if (node instanceof Element) {
        text = node.textContent ?? "";
      }
      const before = text.slice(0, range.startOffset);
      return before.split("\n").length;
    } catch {
      return undefined;
    }
  }

  const updateDomSelection = useCallback(() => {
    if (!mounted) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setSelection(null);
      return;
    }
    const pos = clampPosition(rect.top, rect.left + rect.width / 2);
    setSelection({
      text: text.slice(0, MAX_SELECTED_CHARS),
      top: pos.top,
      left: pos.left,
      lineNumber: estimateLineNumber(range),
    });
    setOpen(false);
  }, [mounted, clampPosition]);

  const handlePointerUp = useCallback(() => requestAnimationFrame(updateDomSelection), [updateDomSelection]);

  useEffect(() => {
    document.addEventListener("mouseup", handlePointerUp);
    document.addEventListener("keyup", handlePointerUp);
    document.addEventListener("touchend", handlePointerUp);
    document.addEventListener("selectionchange", updateDomSelection);
    window.addEventListener("scroll", updateDomSelection, { capture: true, passive: true });
    window.addEventListener("resize", updateDomSelection);
    return () => {
      document.removeEventListener("mouseup", handlePointerUp);
      document.removeEventListener("keyup", handlePointerUp);
      document.removeEventListener("touchend", handlePointerUp);
      document.removeEventListener("selectionchange", updateDomSelection);
      window.removeEventListener("scroll", updateDomSelection, { capture: true });
      window.removeEventListener("resize", updateDomSelection);
    };
  }, [handlePointerUp, updateDomSelection]);

  const dispatchEditRequest = useCallback(() => {
    if (!fileId || !instruction.trim() || !selection) return;
    setSubmitting(true);
    const payload: AIEditRequestPayload = {
      fileId,
      filename: filename ?? "",
      selectedText: selection.text,
      instruction: instruction.trim(),
      ...(selection.lineNumber ? { lineNumber: selection.lineNumber } : {}),
    };
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent<AIEditRequestPayload>(AI_EDIT_REQUEST_EVENT, { detail: payload })
      );
    }
    setOpen(false);
    setInstruction("");
    setSubmitting(false);
    setSelection(null);
  }, [fileId, filename, instruction, selection]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        dispatchEditRequest();
      }
    },
    [dispatchEditRequest]
  );

  const handleUndo = useCallback(() => {
    if (!undoFileId) return;
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent<{ fileId: string }>("devnuby:undo-edit", { detail: { fileId: undoFileId } })
      );
    }
    setUndoFileId(null);
  }, [undoFileId]);

  if (!mounted || !fileId) return null;

  const hasUndo = Boolean(undoFileId);

  return (
    <>
      {/* Trigger pill: appears near selection */}
      {selection && (
        <button
          ref={triggerRef}
          type="button"
          data-inline-edit-trigger="true"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "fixed z-[140] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold backdrop-blur-md transition-colors cursor-pointer select-none animate-[fade-in_120ms_ease-out]",
            "bg-[#161618]/92 text-[#f4f4f5] border border-white/14 shadow-[0_10px_28px_rgba(0,0,0,0.55)] hover:bg-[#222226]"
          )}
          style={{ top: selection.top, left: selection.left }}
          aria-label={t("chatFiles.inlineEdit")}
        >
          <Edit className="w-3.5 h-3.5 shrink-0" />
          <span>{t("chatFiles.inlineEditShort")}</span>
        </button>
      )}

      {/* Popover: instruction input */}
      {selection && open && (
        <div
          className={cn(
            "fixed z-[141] glass rounded-[10px] p-2 shadow-2xl border border-white/10",
            "min-w-[260px] flex flex-col gap-2"
          )}
          style={{ top: selection.top + 30, left: selection.left }}
        >
          <p className="text-[11px] font-medium text-[var(--muted)] mb-1">
            {t("chatFiles.editInstruction")}
          </p>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value.slice(0, MAX_INSTRUCTION_CHARS))}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder={t("chatFiles.editPlaceholder")}
            className="w-full text-xs text-[var(--ink)] bg-transparent border border-[var(--border)] rounded-[6px] px-2.5 py-1.5 focus:ring-1 focus:ring-[var(--accent)] outline-none resize-none"
          />
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-[var(--muted)] hover:text-[var(--ink)] transition-colors cursor-pointer px-2 py-1 rounded-[5px] hover:bg-[var(--hover)]"
            >
              {t("chatFiles.cancel")}
            </button>
            <button
              type="button"
              onClick={dispatchEditRequest}
              disabled={submitting || !instruction.trim()}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold rounded-[6px] transition-colors cursor-pointer",
                submitting || !instruction.trim()
                  ? "text-[var(--muted)] bg-[var(--border)] cursor-not-allowed"
                  : "bg-[var(--accent)] text-[var(--accent-text)] hover:bg-[var(--accent-hover)]"
              )}
            >
              {submitting ? "…" : t("chatFiles.editSend")}
            </button>
          </div>
        </div>
      )}

      {/* Undo chip */}
      {hasUndo && (
        <div className="fixed z-[140] top-4 right-4 glass rounded-[8px] px-3 py-2 border border-white/10 shadow-2xl flex items-center gap-2">
          <span className="text-xs text-[var(--muted)]">{t("chatFiles.undoAvailable")}</span>
          <button
            type="button"
            onClick={handleUndo}
            className="text-xs font-semibold text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors cursor-pointer"
          >
            {t("chatFiles.undo")}
          </button>
          <button
            type="button"
            onClick={() => setUndoFileId(null)}
            className="text-xs text-[var(--muted)] hover:text-[var(--ink)] transition-colors cursor-pointer ml-2"
          >
            <X className="w-3 h-3 shrink-0" />
          </button>
        </div>
      )}
    </>
  );
}
