"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  CLEAR_EDIT_CHIPS_EVENT,
  dispatchAddEditChip,
  REMOVE_EDIT_CHIP_EVENT,
} from "@/lib/files/preview-events";
import { findLineRangeInText } from "./preview-utils";
import { TextEditPopover } from "./text-edit-popover";

export interface DomRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DomInspectorInfo {
  rect: DomRect;
  tagName: string;
  dimensions: string;
  color: string;
  font: string;
}

export interface DomSelectedArea {
  rect: DomRect;
  text: string;
  tagName?: string;
  lineRange?: { startLine: number; endLine: number } | null;
}

export interface DomRequestEditLayerProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  active: boolean;
  content: string;
  fileId?: string;
  filename?: string;
  debugMode: boolean;
  onToggleDebugMode: () => void;
  onSubmitEdit: (prompt: string, selectedArea: DomSelectedArea) => void;
  onCancel: () => void;
}

function rgbToHex(rgbStr: string): string {
  const match = rgbStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return rgbStr;
  const r = parseInt(match[1], 10).toString(16).padStart(2, "0");
  const g = parseInt(match[2], 10).toString(16).padStart(2, "0");
  const b = parseInt(match[3], 10).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`.toUpperCase();
}

/**
 * Visual element inspector, hover highlight, drag marquee, locked selection box,
 * and pin badge for DOM previews (Markdown, DOCX, SVG, etc.).
 */
interface ConfirmedArea {
  id: string;
  target: Element | null;
  rect: DomRect;
  badgeNum: number;
}

function SelectionPinBox({ rect, badgeText, isTeardrop }: { rect: DomRect; badgeText?: string | number; isTeardrop?: boolean }) {
  return (
    <div
      style={{ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }}
      className="absolute border-2 border-[var(--primary)] bg-[var(--primary)]/[0.08] rounded-[4px] z-30 pointer-events-none"
    >
      <div
        style={{ borderRadius: isTeardrop ? "9999px 9999px 2px 9999px" : "10px", transform: isTeardrop ? "rotate(-45deg)" : undefined }}
        className="absolute -top-2.5 -right-2.5 min-w-5 h-5 px-1 bg-[var(--primary)] text-white text-[11px] font-bold font-mono grid place-items-center shadow-md pointer-events-none"
      >
        {isTeardrop ? null : badgeText}
      </div>
    </div>
  );
}

export function DomRequestEditLayer({
  containerRef,
  active,
  content,
  fileId,
  filename,
  debugMode,
  onToggleDebugMode,
  onSubmitEdit,
  onCancel,
}: DomRequestEditLayerProps) {
  const [hoverInfo, setHoverInfo] = useState<DomInspectorInfo | null>(null);
  const [selectedArea, setSelectedArea] = useState<DomSelectedArea | null>(null);
  const [confirmedAreas, setConfirmedAreas] = useState<ConfirmedArea[]>([]);
  const [containerWidth, setContainerWidth] = useState(500);
  const selectedTargetRef = React.useRef<Element | null>(null);

  const [dragStart, setDragStart] = useState<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const isDragging = dragStart !== null;

  // Clear states when disabled
  const [prevActive, setPrevActive] = useState(active);
  if (prevActive !== active) {
    setPrevActive(active);
    if (!active) {
      setHoverInfo(null);
      setSelectedArea(null);
      setConfirmedAreas([]);
      setDragStart(null);
      setDragCurrent(null);
    }
  }

  useEffect(() => {
    if (!active) {
      selectedTargetRef.current = null;
    }
  }, [active]);

  useEffect(() => {
    function onRemoveChip(e: Event) {
      const detail = (e as CustomEvent<{ id: string }>).detail;
      if (detail?.id) {
        setConfirmedAreas((prev) =>
          prev
            .filter((a) => a.id !== detail.id)
            .map((a, idx) => ({ ...a, badgeNum: idx + 1 }))
        );
      }
    }
    function onClearChips() {
      setConfirmedAreas([]);
    }
    window.addEventListener(REMOVE_EDIT_CHIP_EVENT, onRemoveChip);
    window.addEventListener(CLEAR_EDIT_CHIPS_EVENT, onClearChips);
    return () => {
      window.removeEventListener(REMOVE_EDIT_CHIP_EVENT, onRemoveChip);
      window.removeEventListener(CLEAR_EDIT_CHIPS_EVENT, onClearChips);
    };
  }, []);

  const getContainerCoords = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container) return { x: 0, y: 0 };
      const cRect = container.getBoundingClientRect();
      return {
        x: clientX - cRect.left + container.scrollLeft,
        y: clientY - cRect.top + container.scrollTop,
      };
    },
    [containerRef]
  );

  const inspectElement = useCallback(
    (el: Element): DomInspectorInfo | null => {
      const container = containerRef.current;
      if (!container || !container.contains(el) || el === container) return null;
      if (el.closest("[data-edit-layer='true']")) return null;

      const cRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      if (elRect.width === 0 || elRect.height === 0) return null;

      const computed = window.getComputedStyle(el);
      const fontShort = `${computed.fontSize} "${computed.fontFamily.split(",")[0].replace(/['"]/g, "").trim()}"`;

      return {
        rect: {
          x: elRect.left - cRect.left + container.scrollLeft,
          y: elRect.top - cRect.top + container.scrollTop,
          width: elRect.width,
          height: elRect.height,
        },
        tagName: el.tagName.toLowerCase(),
        dimensions: `${Math.round(elRect.width)}x${Math.round(elRect.height)}`,
        color: rgbToHex(computed.color),
        font: fontShort,
      };
    },
    [containerRef]
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!active) return;
      const { x, y } = getContainerCoords(e.clientX, e.clientY);

      if (dragStart) {
        setDragCurrent({ x, y });
        setHoverInfo(null);
      } else if (!selectedArea) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el) {
          const target =
            el.closest("h1, h2, h3, h4, h5, h6, p, li, tr, blockquote, pre, code, a, table, img, div") ||
            el;
          setHoverInfo(inspectElement(target));
        } else {
          setHoverInfo(null);
        }
      }
    },
    [active, dragStart, selectedArea, getContainerCoords, inspectElement]
  );

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      if (!active || e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-edit-popover='true']")) return;

      e.preventDefault();
      const { x, y } = getContainerCoords(e.clientX, e.clientY);
      setDragStart({ x, y, clientX: e.clientX, clientY: e.clientY });
      setDragCurrent({ x, y });
      setSelectedArea(null);
      selectedTargetRef.current = null;
    },
    [active, getContainerCoords]
  );

  const handlePointerUp = useCallback(() => {
    if (!active || !dragStart || !dragCurrent) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }

    const container = containerRef.current;
    const rw = Math.abs(dragCurrent.x - dragStart.x);
    const rh = Math.abs(dragCurrent.y - dragStart.y);

    if (rw >= 10 && rh >= 10 && container) {
      selectedTargetRef.current = null;
      // Marquee selection
      const rx = Math.min(dragStart.x, dragCurrent.x);
      const ry = Math.min(dragStart.y, dragCurrent.y);
      const rect: DomRect = { x: rx, y: ry, width: rw, height: rh };

      // Collect text inside marquee
      const cRect = container.getBoundingClientRect();
      const allTextNodes: string[] = [];
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const parent = node.parentElement;
        if (parent && !parent.closest("[data-edit-layer='true']")) {
          const r = parent.getBoundingClientRect();
          const nodeX = r.left - cRect.left + container.scrollLeft;
          const nodeY = r.top - cRect.top + container.scrollTop;
          const overlaps = nodeX < rx + rw && nodeX + r.width > rx && nodeY < ry + rh && nodeY + r.height > ry;
          if (overlaps && node.textContent?.trim()) {
            allTextNodes.push(node.textContent.trim());
          }
        }
        node = walker.nextNode();
      }

      const textNodes = Array.from(new Set(allTextNodes));
      const text = textNodes.join(" ").trim();
      if (text) {
        const lineRange = findLineRangeInText(content, text, {
          firstText: textNodes[0],
          lastText: textNodes[textNodes.length - 1],
        });
        setSelectedArea({ rect, text, lineRange });
      }
    } else {
      // Single click selection
      const el = document.elementFromPoint(dragStart.clientX, dragStart.clientY);
      if (el && container?.contains(el) && el !== container) {
        const target = el.closest("h1, h2, h3, h4, h5, h6, p, li, tr, blockquote, pre, code, a, table, img, div") || el;
        const info = inspectElement(target);
        if (info) {
          selectedTargetRef.current = target;
          const text = (target instanceof HTMLElement ? target.innerText : target.textContent || "").trim();
          const lineRange = findLineRangeInText(content, text, {
            tagName: info.tagName,
            id: target.id || undefined,
            className: typeof target.className === "string" ? target.className : undefined,
          });
          setSelectedArea({ rect: info.rect, text, tagName: info.tagName, lineRange });
        }
      }
    }

    setDragStart(null);
    setDragCurrent(null);
    setHoverInfo(null);
  }, [active, dragStart, dragCurrent, containerRef, content, inspectElement]);

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;

    const handleClickCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-edit-popover='true']")) return;
      e.preventDefault();
      e.stopPropagation();
    };

    const handleScroll = () => {
      const target = selectedTargetRef.current;
      if (target && target.isConnected) {
        const info = inspectElement(target);
        if (info) {
          setSelectedArea((prev) => (prev ? { ...prev, rect: info.rect } : null));
        }
      }
      setConfirmedAreas((prev) =>
        prev.map((item) => {
          if (item.target && item.target.isConnected) {
            const info = inspectElement(item.target);
            if (info) return { ...item, rect: info.rect };
          }
          return item;
        })
      );
    };

    container.addEventListener("click", handleClickCapture, true);
    container.addEventListener("pointerdown", handlePointerDown);
    container.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      container.removeEventListener("click", handleClickCapture, true);
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [active, containerRef, handlePointerDown, handlePointerMove, handlePointerUp, inspectElement]);

  if (!active) return null;

  function handlePopoverSubmit(prompt: string) {
    if (!selectedArea) return;
    if (debugMode) {
      onSubmitEdit(prompt, selectedArea);
      setSelectedArea(null);
      return;
    }
    const chipId = `chip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const lineRange = selectedArea.lineRange;
    dispatchAddEditChip({
      id: chipId,
      fileId: fileId || "dom-file",
      filename: filename || "preview",
      selectedText: selectedArea.text,
      instruction: prompt || undefined,
      lineNumber: lineRange?.startLine,
      lineEndNumber:
        lineRange && lineRange.endLine !== lineRange.startLine ? lineRange.endLine : undefined,
      tagName: selectedArea.tagName,
      rect: selectedArea.rect,
    });
    setConfirmedAreas((prev) => [
      ...prev,
      {
        id: chipId,
        target: selectedTargetRef.current,
        rect: selectedArea.rect,
        badgeNum: prev.length + 1,
      },
    ]);
    setSelectedArea(null);
    selectedTargetRef.current = null;
  }

  const liveDragRect: DomRect | null =
    isDragging && dragStart && dragCurrent
      ? {
          x: Math.min(dragStart.x, dragCurrent.x),
          y: Math.min(dragStart.y, dragCurrent.y),
          width: Math.abs(dragCurrent.x - dragStart.x),
          height: Math.abs(dragCurrent.y - dragStart.y),
        }
      : null;

  return (
    <div
      data-edit-layer="true"
      className="absolute inset-0 pointer-events-none z-30 select-none overflow-visible"
    >
      {/* 1. Temporary Hover Box & Inspector Tooltip (Matching Image 2) */}
      {hoverInfo && !isDragging && !selectedArea && (
        <>
          <div
            style={{
              position: "absolute",
              left: `${hoverInfo.rect.x}px`,
              top: `${hoverInfo.rect.y}px`,
              width: `${hoverInfo.rect.width}px`,
              height: `${hoverInfo.rect.height}px`,
              border: "1.5px solid #38bdf8",
              backgroundColor: "rgba(56, 189, 248, 0.06)",
              borderRadius: "4px",
              pointerEvents: "none",
            }}
          />

          {/* Inspector Tooltip (Exact match with glass utility) */}
          <div
            style={{
              position: "absolute",
              left: `${Math.max(8, Math.min(containerWidth - 220, hoverInfo.rect.x))}px`,
              top: `${hoverInfo.rect.y >= 78 ? hoverInfo.rect.y - 74 : hoverInfo.rect.y + hoverInfo.rect.height + 8}px`,
              zIndex: 35,
            }}
            className="flex flex-col gap-1 px-3 py-2 rounded-[8px] glass text-[var(--ink)] shadow-2xl pointer-events-none min-w-[190px]"
          >
            <div className="flex items-center justify-between gap-4 font-semibold text-[var(--ink)] text-[12.5px] border-b border-[var(--border)] pb-1">
              <span>{hoverInfo.tagName}</span>
              <span className="text-[var(--muted)] font-mono text-[11px] font-normal">
                {hoverInfo.dimensions}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 text-[11px] text-[var(--muted)]">
              <span>color</span>
              <span className="font-mono text-[var(--ink)]">{hoverInfo.color}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-[11px] text-[var(--muted)]">
              <span>font</span>
              <span className="font-mono text-[var(--ink)] truncate max-w-[120px]">
                {hoverInfo.font}
              </span>
            </div>
          </div>
        </>
      )}

      {/* 2. Drag Marquee Box ("user bebas select") */}
      {liveDragRect && liveDragRect.width > 2 && liveDragRect.height > 2 && (
        <div
          style={{
            position: "absolute",
            left: `${liveDragRect.x}px`,
            top: `${liveDragRect.y}px`,
            width: `${liveDragRect.width}px`,
            height: `${liveDragRect.height}px`,
            border: "1.5px dashed #38bdf8",
            backgroundColor: "rgba(56, 189, 248, 0.12)",
            borderRadius: "4px",
            pointerEvents: "none",
            zIndex: 32,
          }}
        />
      )}

      {/* Persistent Confirmed Multi-Selection Boxes (Numbered #1, #2...) */}
      {confirmedAreas.map((item) => (
        <SelectionPinBox key={item.id} rect={item.rect} badgeText={item.badgeNum} />
      ))}

      {/* 3. Locked Active Selection Box with Blue Teardrop Pin Badge (Image 2) */}
      {selectedArea && <SelectionPinBox rect={selectedArea.rect} isTeardrop />}

      {/* 4. Popover Clamped Strictly Inside Preview Container */}
      {selectedArea && (
        <div
          data-edit-popover="true"
          className="pointer-events-auto"
        >
          <TextEditPopover
            top={selectedArea.rect.y + selectedArea.rect.height + 8}
            left={Math.max(12, Math.min(containerWidth - 430, selectedArea.rect.x))}
            positionMode="absolute"
            badgeLabel={
              selectedArea.lineRange
                ? selectedArea.lineRange.startLine === selectedArea.lineRange.endLine
                  ? `Line ${selectedArea.lineRange.startLine}`
                  : `Lines ${selectedArea.lineRange.startLine}-${selectedArea.lineRange.endLine}`
                : selectedArea.tagName ? `<${selectedArea.tagName}>` : undefined
            }
            debugMode={debugMode}
            onToggleDebugMode={onToggleDebugMode}
            onSubmit={handlePopoverSubmit}
            onCancel={() => { setSelectedArea(null); onCancel(); }}
          />
        </div>
      )}
    </div>
  );
}
