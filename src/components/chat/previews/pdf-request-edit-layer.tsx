"use client";

import React, { useState } from "react";
import { useI18n } from "@/providers/i18n-provider";
import { PdfEditPopover } from "./pdf-edit-popover";
import type { PdfLiveEdit, PdfRect, PdfSelectedArea } from "./pdf-edit-types";

export interface PdfRequestEditLayerProps {
  pageNumber: number;
  pageWidth: number;
  active: boolean;
  debugMode: boolean;
  onToggleDebugMode: () => void;
  selectedArea: PdfSelectedArea | null;
  onSelectArea: (sel: PdfSelectedArea | null) => void;
  onSubmitEdit: (prompt: string, selectedArea: PdfSelectedArea) => void;
  textContainerRef: React.RefObject<HTMLDivElement | null>;
  liveEdits: PdfLiveEdit[];
  onRemoveLiveEdit: (id: string) => void;
}

export function PdfRequestEditLayer({
  pageNumber,
  pageWidth,
  active,
  debugMode,
  onToggleDebugMode,
  selectedArea,
  onSelectArea,
  onSubmitEdit,
  textContainerRef,
  liveEdits,
  onRemoveLiveEdit,
}: PdfRequestEditLayerProps) {
  const { t } = useI18n();
  const [hoverRect, setHoverRect] = useState<PdfRect | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);

  if (!active && liveEdits.length === 0 && !selectedArea) {
    return null;
  }

  function findSpanUnderPoint(px: number, py: number): HTMLElement | null {
    const textContainer = textContainerRef.current;
    if (!textContainer) return null;

    for (const child of Array.from(textContainer.children)) {
      if (!(child instanceof HTMLElement)) continue;
      const x1 = child.offsetLeft;
      const y1 = child.offsetTop;
      const x2 = x1 + child.offsetWidth;
      const y2 = y1 + child.offsetHeight;
      if (px >= x1 && px <= x2 && py >= y1 && py <= y2) {
        return child;
      }
    }
    return null;
  }

  function getIntersectingText(rect: PdfRect): string {
    const textContainer = textContainerRef.current;
    if (!textContainer) return "";

    const bx1 = rect.x;
    const by1 = rect.y;
    const bx2 = rect.x + rect.width;
    const by2 = rect.y + rect.height;

    const matchedSpans: HTMLElement[] = [];
    for (const child of Array.from(textContainer.children)) {
      if (!(child instanceof HTMLElement)) continue;
      const sx1 = child.offsetLeft;
      const sy1 = child.offsetTop;
      const sx2 = sx1 + child.offsetWidth;
      const sy2 = sy1 + child.offsetHeight;

      const overlaps = sx1 < bx2 && sx2 > bx1 && sy1 < by2 && sy2 > by1;
      if (overlaps) {
        matchedSpans.push(child);
      }
    }

    matchedSpans.sort((a, b) => {
      const topDiff = a.offsetTop - b.offsetTop;
      return Math.abs(topDiff) > 4 ? topDiff : a.offsetLeft - b.offsetLeft;
    });

    return matchedSpans
      .map((s) => s.dataset.rawText || s.textContent || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!active || e.button !== 0) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - bounds.left;
    const y = e.clientY - bounds.top;

    setDragStart({ x, y });
    setDragCurrent({ x, y });
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!active) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - bounds.left;
    const y = e.clientY - bounds.top;

    if (dragStart) {
      setDragCurrent({ x, y });
      setHoverRect(null);
    } else {
      const span = findSpanUnderPoint(x, y);
      if (span) {
        setHoverRect({
          x: span.offsetLeft - 2,
          y: span.offsetTop - 1,
          width: span.offsetWidth + 4,
          height: span.offsetHeight + 2,
        });
      } else {
        setHoverRect(null);
      }
    }
  }

  function handleMouseUp() {
    if (!active || !dragStart || !dragCurrent) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }

    const rx = Math.min(dragStart.x, dragCurrent.x);
    const ry = Math.min(dragStart.y, dragCurrent.y);
    const rw = Math.abs(dragCurrent.x - dragStart.x);
    const rh = Math.abs(dragCurrent.y - dragStart.y);

    setDragStart(null);
    setDragCurrent(null);

    // If dragged an area larger than 8px
    if (rw >= 8 && rh >= 8) {
      const rect: PdfRect = { x: rx, y: ry, width: rw, height: rh };
      const text = getIntersectingText(rect);
      onSelectArea({ pageNumber, rect, text });
      setHoverRect(null);
      return;
    }

    // Else single click on a span
    const span = findSpanUnderPoint(dragStart.x, dragStart.y);
    if (span) {
      const rect: PdfRect = {
        x: span.offsetLeft - 2,
        y: span.offsetTop - 1,
        width: span.offsetWidth + 4,
        height: span.offsetHeight + 2,
      };
      const text = (span.dataset.rawText || span.textContent || "").trim();
      onSelectArea({ pageNumber, rect, text });
      setHoverRect(null);
    } else {
      onSelectArea(null);
    }
  }

  // Active drag marquee box
  const liveDragRect: PdfRect | null =
    dragStart && dragCurrent
      ? {
          x: Math.min(dragStart.x, dragCurrent.x),
          y: Math.min(dragStart.y, dragCurrent.y),
          width: Math.abs(dragCurrent.x - dragStart.x),
          height: Math.abs(dragCurrent.y - dragStart.y),
        }
      : null;

  const isCurrentPageSelected = selectedArea?.pageNumber === pageNumber;

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        setHoverRect(null);
        if (dragStart) {
          setDragStart(null);
          setDragCurrent(null);
        }
      }}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: active ? 15 : 5,
        cursor: active ? "crosshair" : "default",
        pointerEvents: active || liveEdits.length > 0 || isCurrentPageSelected ? "auto" : "none",
      }}
    >
      {/* 1. Live Edits Overlays (Opaque replacement on PDF) */}
      {liveEdits.map((edit) => (
        <div
          key={edit.id}
          style={{
            position: "absolute",
            left: `${edit.rect.x}px`,
            top: `${edit.rect.y}px`,
            width: `${Math.max(edit.rect.width, 100)}px`,
            minHeight: `${edit.rect.height}px`,
            zIndex: 25,
          }}
          className="group bg-white text-neutral-900 border border-blue-400 rounded-[3px] shadow-sm px-1.5 py-0.5 text-xs font-serif leading-snug select-text"
        >
          <div className="flex items-center justify-between text-[9px] font-sans font-medium text-blue-600 pb-0.5 border-b border-blue-100 select-none">
            <span>{t("chatFiles.requestEditsLiveBadge")}</span>
            <button
              type="button"
              onClick={() => onRemoveLiveEdit(edit.id)}
              className="opacity-0 group-hover:opacity-100 hover:text-red-600 transition-opacity cursor-pointer text-[9px]"
              title={t("chatFiles.undo")}
            >
              {t("chatFiles.requestEditsRevert")}
            </button>
          </div>
          <div className="pt-0.5">{edit.replacementText}</div>
        </div>
      ))}

      {/* 2. Temporary Hover Border (Gambar 3) */}
      {active && hoverRect && !liveDragRect && !isCurrentPageSelected && (
        <div
          style={{
            position: "absolute",
            left: `${hoverRect.x}px`,
            top: `${hoverRect.y}px`,
            width: `${hoverRect.width}px`,
            height: `${hoverRect.height}px`,
            border: "1.5px solid #38bdf8",
            backgroundColor: "rgba(56, 189, 248, 0.06)",
            borderRadius: "2px",
            pointerEvents: "none",
            zIndex: 20,
          }}
        />
      )}

      {/* 3. Live Drag Marquee Box */}
      {active && liveDragRect && liveDragRect.width > 2 && liveDragRect.height > 2 && (
        <div
          style={{
            position: "absolute",
            left: `${liveDragRect.x}px`,
            top: `${liveDragRect.y}px`,
            width: `${liveDragRect.width}px`,
            height: `${liveDragRect.height}px`,
            border: "1.5px dashed #38bdf8",
            backgroundColor: "rgba(56, 189, 248, 0.12)",
            borderRadius: "3px",
            pointerEvents: "none",
            zIndex: 22,
          }}
        />
      )}

      {/* 4. Locked Selection Box with Blue Pin (Gambar 4 & 5) */}
      {isCurrentPageSelected && selectedArea && (
        <>
          <div
            style={{
              position: "absolute",
              left: `${selectedArea.rect.x}px`,
              top: `${selectedArea.rect.y}px`,
              width: `${selectedArea.rect.width}px`,
              height: `${selectedArea.rect.height}px`,
              border: "1.5px dashed #38bdf8",
              backgroundColor: "rgba(56, 189, 248, 0.12)",
              borderRadius: "3px",
              zIndex: 30,
              pointerEvents: "none",
            }}
          >
            {/* Blue Pin Badge at top-right corner */}
            <div
              style={{
                position: "absolute",
                top: "-8px",
                right: "-8px",
                width: "16px",
                height: "16px",
                backgroundColor: "#2563eb",
                borderRadius: "9999px 9999px 2px 9999px",
                transform: "rotate(-45deg)",
                boxShadow: "0 2px 6px rgba(37, 99, 235, 0.4)",
              }}
            />
          </div>

          {/* Floating Dark Pill Popover (Gambar 4 & 5) */}
          <PdfEditPopover
            rect={selectedArea.rect}
            pageWidth={pageWidth}
            debugMode={debugMode}
            onToggleDebugMode={onToggleDebugMode}
            onSubmit={(prompt) => onSubmitEdit(prompt, selectedArea)}
            onCancel={() => onSelectArea(null)}
          />
        </>
      )}
    </div>
  );
}
