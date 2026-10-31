"use client";

import { useEffect, useState, type RefObject } from "react";

export interface ViewerZoomOptions {
  scrollRef: RefObject<HTMLElement | null>;
  /** Unscaled content width in px; 0 = unknown (fit scale falls back to 1) */
  naturalWidth: number;
  /** Horizontal space kept free on each side when fitting */
  gutter?: number;
  min?: number;
  max?: number;
  step?: number;
  /** Upper bound for the automatic fit-to-width scale */
  maxFit?: number;
}

export interface ViewerZoom {
  scale: number;
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Back to automatic fit-to-width */
  fitWidth: () => void;
}

/** Fit-to-width zoom with manual +/- steps, shared by the document previews. */
export function useViewerZoom({
  scrollRef,
  naturalWidth,
  gutter = 20,
  min = 0.25,
  max = 3,
  step = 0.1,
  maxFit = 1,
}: ViewerZoomOptions): ViewerZoom {
  const [containerWidth, setContainerWidth] = useState(0);
  const [manual, setManual] = useState<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRef]);

  const fit =
    naturalWidth > 0 && containerWidth > gutter * 2
      ? Math.min(maxFit, Math.max(min, (containerWidth - gutter * 2) / naturalWidth))
      : 1;
  const scale = manual ?? fit;
  const round = (v: number) => Number(v.toFixed(2));

  return {
    scale,
    zoomPercent: Math.round(scale * 100),
    canZoomIn: scale < max - 0.001,
    canZoomOut: scale > min + 0.001,
    zoomIn: () => setManual(Math.min(max, round(scale + step))),
    zoomOut: () => setManual(Math.max(min, round(scale - step))),
    fitWidth: () => setManual(null),
  };
}
