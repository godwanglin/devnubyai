"use client";

import React, { useEffect, useRef, useState } from "react";
import type { DraftBlock, DraftPageSize } from "@/lib/live-draft/types";
import { blockLineHeight, blockSpacing, DraftBlockView } from "./draft-blocks";
import { ScaledPage } from "./scaled-page";

interface Measured {
  tops: number[];
  heights: number[];
}

interface PageSlice {
  start: number;
  end: number;
}

const MAX_PAGES = 200;

/**
 * Splits the measured column into pages: at forced page breaks, between blocks when the
 * next one does not fit, or inside a tall paragraph / table on a line boundary.
 */
function paginate(blocks: DraftBlock[], m: Measured, contentHeight: number): PageSlice[] {
  const count = Math.min(blocks.length, m.tops.length);
  if (count === 0) return [];
  const total = m.tops[count - 1] + m.heights[count - 1];
  const pages: PageSlice[] = [];
  let start = 0;
  while (start < total - 0.5 && pages.length < MAX_PAGES) {
    const limit = start + contentHeight;
    let end = limit;
    for (let i = 0; i < count; i += 1) {
      const top = m.tops[i];
      const bottom = top + m.heights[i];
      if (bottom <= start) continue;
      if (top >= limit) break;
      const block = blocks[i];
      if (block.type === "pagebreak" && top > start) {
        end = top;
        break;
      }
      if (bottom > limit) {
        const line = blockLineHeight(block);
        const contentTop = top + blockSpacing(block).before;
        const fitLines = line > 0 ? Math.floor((limit - Math.max(contentTop, start)) / line) : 0;
        if (line > 0 && (fitLines >= 2 || top <= start)) end = Math.max(contentTop, start) + Math.max(1, fitLines) * line;
        else if (top > start) end = top;
        break;
      }
    }
    if (end <= start + 1) end = limit;
    pages.push({ start, end: Math.min(end, total) });
    start = end;
    // Nothing but a page break left on the new page
    const rest = blocks.findIndex((b, i) => i < count && m.tops[i] + m.heights[i] > start && b.type !== "pagebreak" && b.type !== "spacer");
    if (rest < 0) break;
  }
  return pages;
}

function sameMeasure(a: Measured | null, b: Measured): boolean {
  if (!a || a.tops.length !== b.tops.length) return false;
  for (let i = 0; i < a.tops.length; i += 1) {
    if (Math.abs(a.tops[i] - b.tops[i]) > 0.5 || Math.abs(a.heights[i] - b.heights[i]) > 0.5) return false;
  }
  return true;
}

function BlockSlot({ block, caret }: { block: DraftBlock; caret: boolean }) {
  const { before, after } = blockSpacing(block);
  return (
    <div style={{ paddingTop: `${before}px`, paddingBottom: `${after}px` }}>
      <DraftBlockView block={block} caret={caret} />
    </div>
  );
}

export function DraftFlowPages({
  page,
  blocks,
  caretIndex,
  scale,
}: {
  page: DraftPageSize;
  blocks: DraftBlock[];
  /** Index of the block the AI is typing in (-1: none) */
  caretIndex: number;
  scale: number;
}) {
  const contentWidth = Math.max(40, page.width - page.margins.left - page.margins.right);
  const contentHeight = Math.max(40, page.height - page.margins.top - page.margins.bottom);
  const measureRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);

  // Measure every block in an unscaled hidden column; re-measured whenever anything resizes
  useEffect(() => {
    const column = measureRef.current;
    if (!column || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const children = Array.from(column.children) as HTMLElement[];
      const next = { tops: children.map((c) => c.offsetTop), heights: children.map((c) => c.offsetHeight) };
      setMeasured((prev) => (sameMeasure(prev, next) ? prev : next));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    for (const child of Array.from(column.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [blocks, contentWidth]);

  const usable = measured && measured.tops.length === blocks.length ? measured : null;
  const pages = usable ? paginate(blocks, usable, contentHeight) : [];

  return (
    <>
      <div
        ref={measureRef}
        aria-hidden="true"
        style={{ position: "absolute", left: -100000, top: 0, width: `${contentWidth}px`, visibility: "hidden", pointerEvents: "none" }}
      >
        {blocks.map((block, i) => (
          <BlockSlot key={i} block={block} caret={i === caretIndex} />
        ))}
      </div>

      {pages.map((slice, pageIndex) => (
        <ScaledPage key={pageIndex} width={page.width} height={page.height} scale={scale}>
          <div
            style={{
              position: "absolute",
              left: page.margins.left,
              top: page.margins.top,
              width: contentWidth,
              height: slice.end - slice.start,
              overflow: "hidden",
            }}
          >
            {blocks.map((block, i) => {
              if (!usable) return null;
              const top = usable.tops[i];
              const bottom = top + usable.heights[i];
              if (bottom <= slice.start || top >= slice.end) return null;
              return (
                <div key={i} style={{ position: "absolute", left: 0, right: 0, top: top - slice.start }}>
                  <BlockSlot block={block} caret={i === caretIndex} />
                </div>
              );
            })}
          </div>
        </ScaledPage>
      ))}
    </>
  );
}
