"use client";

import React, { useEffect, useState } from "react";
import { MessageSquareQuote } from "lucide-react";
import { cn } from "@/lib/cn";
import { MAX_QUOTE_CHARS } from "@/lib/chat/quotes";
import {
  EXTERNAL_TEXT_SELECTION_EVENT,
  type ExternalTextSelectionPayload,
} from "@/lib/files/preview-events";
import { useI18n } from "@/providers/i18n-provider";

interface SelectionAskButtonProps {
  /** Fallback primary container (also supports any element marked `data-ask-selectable="true"`) */
  containerRef?: React.RefObject<HTMLElement | null>;
  enabled?: boolean;
  onAsk: (text: string) => void;
}

interface SelectionState {
  text: string;
  top: number;
  left: number;
  tone: "light" | "dark";
}

function isEditable(node: Node | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement;
  return Boolean(el?.closest("input, textarea, [contenteditable='true']"));
}

function isInsideSelectableRegion(
  node: Node | null,
  fallbackContainer: HTMLElement | null
): boolean {
  if (!node) return false;
  if (fallbackContainer?.contains(node)) return true;
  const el = node instanceof Element ? node : node.parentElement;
  return Boolean(el?.closest("[data-ask-selectable='true']"));
}

function clampPosition(rawTop: number, rawLeft: number): { top: number; left: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  return {
    top: Math.max(10, rawTop - 44),
    left: Math.max(84, Math.min(vw - 84, rawLeft)),
  };
}

function parseCssRgba(css: string): [number, number, number, number] | null {
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  return [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    m[4] === undefined ? 1 : Number(m[4]),
  ];
}

function sampleCanvasPixel(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number
): [number, number, number, number] | null {
  try {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
      return null;
    }
    const cx = Math.floor(((clientX - rect.left) / rect.width) * canvas.width);
    const cy = Math.floor(((clientY - rect.top) / rect.height) * canvas.height);
    if (cx < 0 || cy < 0 || cx >= canvas.width || cy >= canvas.height) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const pixel = ctx.getImageData(cx, cy, 1, 1).data;
    return [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
  } catch {
    return null;
  }
}

function sampleLuminanceAtPoint(x: number, y: number): number {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const px = Math.max(2, Math.min(vw - 2, x));
  const py = Math.max(2, Math.min(vh - 2, y));

  const stack = document.elementsFromPoint(px, py);
  let accAlpha = 0;
  let r = 0;
  let g = 0;
  let b = 0;

  for (const el of stack) {
    if (el.closest("[data-selection-ask-pill='true']")) continue;

    // Sample rendered PDF / chart canvas pixels directly when hovering a canvas or PDF page
    const canvas =
      el instanceof HTMLCanvasElement
        ? el
        : el.classList.contains("devnuby-pdf-page")
          ? el.querySelector("canvas")
          : null;
    if (canvas) {
      const pxColor = sampleCanvasPixel(canvas, px, py);
      if (pxColor && pxColor[3] > 0.02) {
        const w = pxColor[3] * (1 - accAlpha);
        r += pxColor[0] * w;
        g += pxColor[1] * w;
        b += pxColor[2] * w;
        accAlpha += w;
        if (accAlpha >= 0.92) break;
      }
    }

    const bg = parseCssRgba(window.getComputedStyle(el).backgroundColor);
    if (bg && bg[3] > 0.02) {
      const w = bg[3] * (1 - accAlpha);
      r += bg[0] * w;
      g += bg[1] * w;
      b += bg[2] * w;
      accAlpha += w;
      if (accAlpha >= 0.92) break;
    }
  }

  if (accAlpha < 0.92) {
    const isDarkTheme = document.documentElement.getAttribute("data-theme") === "dark";
    const fallback = isDarkTheme ? 10 : 250;
    const rem = 1 - accAlpha;
    r += fallback * rem;
    g += fallback * rem;
    b += fallback * rem;
  }

  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Samples multiple horizontal points underneath the floating pill footprint to
 * determine whether the dominant underlying surface is light (white) or dark.
 */
function detectSurfaceTone(pillTop: number, pillCenterX: number): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  const cy = pillTop + 15;
  const l1 = sampleLuminanceAtPoint(pillCenterX - 28, cy);
  const l2 = sampleLuminanceAtPoint(pillCenterX, cy);
  const l3 = sampleLuminanceAtPoint(pillCenterX + 28, cy);
  const avgLuminance = (l1 + l2 + l3) / 3;
  return avgLuminance > 0.55 ? "light" : "dark";
}

export function SelectionAskButton({
  containerRef,
  enabled = true,
  onAsk,
}: SelectionAskButtonProps) {
  const { t } = useI18n();
  const [selection, setSelection] = useState<SelectionState | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function updateDomSelection() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSelection(null);
        return;
      }
      const text = sel.toString().trim();
      const range = sel.getRangeAt(0);
      const container = containerRef?.current ?? null;
      if (
        !text ||
        !isInsideSelectableRegion(range.commonAncestorContainer, container) ||
        isEditable(sel.anchorNode) ||
        isEditable(sel.focusNode)
      ) {
        setSelection(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setSelection(null);
        return;
      }
      const pos = clampPosition(rect.top, rect.left + rect.width / 2);
      setSelection({
        text: text.slice(0, MAX_QUOTE_CHARS),
        top: pos.top,
        left: pos.left,
        tone: detectSurfaceTone(pos.top, pos.left),
      });
    }

    function handlePointerUp() {
      requestAnimationFrame(updateDomSelection);
    }

    function handleSelectionChange() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setSelection((prev) => (prev ? null : prev));
      }
    }

    function handleExternalSelection(e: Event) {
      const detail = (e as CustomEvent<ExternalTextSelectionPayload | null>).detail;
      if (!detail || !detail.text.trim()) {
        setSelection(null);
        return;
      }
      const pos = clampPosition(detail.top, detail.left);
      setSelection({
        text: detail.text.slice(0, MAX_QUOTE_CHARS),
        top: pos.top,
        left: pos.left,
        tone: detail.surfaceTone ?? detectSurfaceTone(pos.top, pos.left),
      });
    }

    document.addEventListener("mouseup", handlePointerUp);
    document.addEventListener("keyup", handlePointerUp);
    document.addEventListener("touchend", handlePointerUp);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("scroll", updateDomSelection, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", updateDomSelection);
    window.addEventListener(EXTERNAL_TEXT_SELECTION_EVENT, handleExternalSelection);

    return () => {
      document.removeEventListener("mouseup", handlePointerUp);
      document.removeEventListener("keyup", handlePointerUp);
      document.removeEventListener("touchend", handlePointerUp);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("scroll", updateDomSelection, { capture: true });
      window.removeEventListener("resize", updateDomSelection);
      window.removeEventListener(EXTERNAL_TEXT_SELECTION_EVENT, handleExternalSelection);
    };
  }, [containerRef, enabled]);

  if (!enabled || !selection) return null;

  const isLightSurface = selection.tone === "light";

  return (
    <button
      type="button"
      data-selection-ask-pill="true"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onAsk(selection.text);
        window.getSelection()?.removeAllRanges();
        setSelection(null);
      }}
      style={{ top: selection.top, left: selection.left }}
      className={cn(
        "fixed z-[130] -translate-x-1/2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold backdrop-blur-md transition-colors cursor-pointer select-none animate-[fade-in_120ms_ease-out]",
        isLightSurface
          ? "bg-white/95 text-[#18181b] border border-black/14 shadow-[0_8px_24px_rgba(15,23,42,0.16)] hover:bg-[#f4f4f5]"
          : "bg-[#161618]/92 text-[#f4f4f5] border border-white/14 shadow-[0_10px_28px_rgba(0,0,0,0.55)] hover:bg-[#222226]"
      )}
    >
      <MessageSquareQuote
        className={cn(
          "w-3.5 h-3.5 shrink-0",
          isLightSurface ? "text-[#52525b]" : "text-[#a1a1aa]"
        )}
      />
      {t("selection.askDevnuby")}
    </button>
  );
}
