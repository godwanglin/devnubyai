"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { getLocalStorage, setLocalStorage } from "@/lib/storage";

export interface UseResizablePanelOptions {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  maxViewportRatio?: number;
  edge: "left" | "right";
  storageKey?: string;
  /** CSS custom property mutated directly on `panelRef` for 60fps zero-re-render dragging */
  cssVar?: string;
  /** Live upper bound while dragging (overrides `maxViewportRatio`), e.g. "leave room for the chat" */
  getMaxWidth?: () => number;
  /** Called on every drag frame and when the width is committed */
  onWidthChange?: (width: number) => void;
}

const widthListeners = new Set<() => void>();

function subscribeWidth(listener: () => void) {
  widthListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    widthListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function notifyWidthChange() {
  widthListeners.forEach((l) => l());
}

export function useResizablePanel({
  defaultWidth,
  minWidth,
  maxWidth,
  maxViewportRatio = 0.55,
  edge,
  storageKey,
  cssVar,
  getMaxWidth,
  onWidthChange,
}: UseResizablePanelOptions) {
  const panelRef = useRef<HTMLElement | null>(null);

  const readStoredWidth = useCallback(() => {
    if (!storageKey) return defaultWidth;
    const raw = getLocalStorage<number>(storageKey, defaultWidth);
    if (typeof raw !== "number" || !Number.isFinite(raw)) return defaultWidth;
    return Math.min(maxWidth, Math.max(minWidth, raw));
  }, [storageKey, defaultWidth, minWidth, maxWidth]);

  const storedWidth = useSyncExternalStore(
    subscribeWidth,
    readStoredWidth,
    () => defaultWidth
  );

  const [isDragging, setIsDragging] = useState(false);
  const [fallbackDragWidth, setFallbackDragWidth] = useState<number | null>(null);
  const [unpersistedWidth, setUnpersistedWidth] = useState<number>(defaultWidth);

  const baseWidth = storageKey ? storedWidth : unpersistedWidth;
  const width = fallbackDragWidth ?? baseWidth;

  const commitWidth = useCallback(
    (next: number) => {
      const clamped = Math.min(maxWidth, Math.max(minWidth, Math.round(next)));
      if (cssVar && panelRef.current) {
        panelRef.current.style.setProperty(cssVar, `${clamped}px`);
      }
      if (storageKey) {
        setLocalStorage(storageKey, clamped);
        notifyWidthChange();
      } else {
        setUnpersistedWidth(clamped);
      }
      onWidthChange?.(clamped);
    },
    [cssVar, maxWidth, minWidth, storageKey, onWidthChange]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      const targetEl = e.currentTarget;
      try {
        targetEl.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if synthetic pointer
      }

      const startX = e.clientX;
      const renderedWidth = panelRef.current?.getBoundingClientRect().width;
      const startWidth = renderedWidth && renderedWidth > 0 ? Math.round(renderedWidth) : width;
      let latestWidth = startWidth;
      let rafId: number | null = null;
      const useDirectDom = Boolean(cssVar && panelRef.current);

      setIsDragging(true);

      // Lock global cursor + disable iframe pointer stealing during drag
      const dragStyle = document.createElement("style");
      dragStyle.setAttribute("data-panel-resizing", "true");
      dragStyle.textContent =
        "*{cursor:col-resize!important;user-select:none!important;}iframe{pointer-events:none!important;}";
      document.head.appendChild(dragStyle);

      function applyFrame() {
        rafId = null;
        if (useDirectDom && cssVar && panelRef.current) {
          panelRef.current.style.setProperty(cssVar, `${latestWidth}px`);
        } else {
          setFallbackDragWidth(latestWidth);
        }
        onWidthChange?.(latestWidth);
      }

      function onPointerMove(ev: PointerEvent) {
        const deltaX =
          edge === "right" ? ev.clientX - startX : startX - ev.clientX;
        const viewportCap = getMaxWidth
          ? Math.floor(getMaxWidth())
          : Math.floor(window.innerWidth * maxViewportRatio);
        const maxAllowed = Math.max(minWidth, Math.min(maxWidth, viewportCap));
        latestWidth = Math.min(
          maxAllowed,
          Math.max(minWidth, Math.round(startWidth + deltaX))
        );
        if (rafId === null) {
          rafId = window.requestAnimationFrame(applyFrame);
        }
      }

      function finishDrag() {
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
        }
        dragStyle.remove();
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", finishDrag);
        window.removeEventListener("pointercancel", finishDrag);

        commitWidth(latestWidth);
        setFallbackDragWidth(null);
        setIsDragging(false);
      }

      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("pointerup", finishDrag);
      window.addEventListener("pointercancel", finishDrag);
    },
    [commitWidth, cssVar, edge, maxViewportRatio, maxWidth, minWidth, width, getMaxWidth, onWidthChange]
  );

  const resetWidth = useCallback(() => {
    commitWidth(defaultWidth);
  }, [commitWidth, defaultWidth]);

  return {
    panelRef,
    width,
    isDragging,
    handlePointerDown,
    resetWidth,
  };
}
