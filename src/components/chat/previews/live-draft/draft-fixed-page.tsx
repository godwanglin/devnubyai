"use client";

import React from "react";
import { ImageIcon } from "lucide-react";
import type { DraftPageSize, FixedItem } from "@/lib/live-draft/types";
import { DraftBlockView, blockSpacing, textCss } from "./draft-blocks";
import { DraftInline } from "./draft-inline";
import { ScaledPage } from "./scaled-page";

/** A canvas page or a slide: shapes in SVG, text and flows as positioned HTML. */
export function DraftFixedPage({
  page,
  background,
  items,
  caretItem,
  scale,
}: {
  page: DraftPageSize;
  background?: string;
  items: FixedItem[];
  /** Index of the item the AI is typing in (-1: none) */
  caretItem: number;
  scale: number;
}) {
  const shapes = items.filter((item): item is Extract<FixedItem, { type: "shape" }> => item.type === "shape");
  return (
    <ScaledPage width={page.width} height={page.height} scale={scale} background={background ?? "#ffffff"}>
      <svg width={page.width} height={page.height} style={{ position: "absolute", inset: 0 }} aria-hidden="true">
        {shapes.map((shape, i) => {
          const stroke = shape.stroke ?? "none";
          const fill = shape.fill ?? "none";
          const sw = shape.stroke ? shape.strokeWidth ?? 1 : 0;
          if (shape.shape === "line") {
            return <line key={i} x1={shape.x} y1={shape.y} x2={shape.x + shape.w} y2={shape.y + shape.h} stroke={shape.stroke ?? "#000"} strokeWidth={shape.strokeWidth ?? 1} />;
          }
          if (shape.shape === "ellipse") {
            return <ellipse key={i} cx={shape.x + shape.w / 2} cy={shape.y + shape.h / 2} rx={Math.abs(shape.w / 2)} ry={Math.abs(shape.h / 2)} fill={fill} stroke={stroke} strokeWidth={sw} />;
          }
          return <rect key={i} x={shape.x} y={shape.y} width={Math.abs(shape.w)} height={Math.abs(shape.h)} rx={shape.radius ?? 0} fill={fill} stroke={stroke} strokeWidth={sw} />;
        })}
      </svg>

      {items.map((item, i) => {
        if (item.type === "shape") return null;
        if (item.type === "image") {
          return (
            <div
              key={i}
              className="flex flex-col items-center justify-center gap-1 border border-dashed border-[#94a3b8] bg-[#e2e8f0]/80 text-[#475569]"
              style={{ position: "absolute", left: item.x, top: item.y, width: Math.max(8, item.w), height: Math.max(8, item.h) }}
            >
              <ImageIcon style={{ width: Math.min(28, item.h / 3), height: Math.min(28, item.h / 3) }} />
              <span style={{ fontSize: 10, fontFamily: "Arial, sans-serif", maxWidth: "90%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
            </div>
          );
        }
        if (item.type === "flow") {
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: item.x,
                width: item.w,
                ...(item.anchorBottom ? { bottom: page.height - item.y } : { top: item.y }),
                maxHeight: item.h,
                overflow: item.h ? "hidden" : undefined,
              }}
            >
              {item.blocks.map((block, b) => {
                const { before, after } = blockSpacing(block);
                return (
                  <div key={b} style={{ paddingTop: before, paddingBottom: after }}>
                    <DraftBlockView block={block} caret={false} />
                  </div>
                );
              })}
            </div>
          );
        }
        // Text: single-line canvas strings, or wrapped slide text boxes
        const css = textCss(item.style);
        const boxed = item.w !== undefined;
        const translate = item.anchor === "middle" ? "translateX(-50%)" : item.anchor === "end" ? "translateX(-100%)" : undefined;
        return (
          <div
            key={i}
            style={{
              ...css,
              position: "absolute",
              left: item.x,
              top: item.y,
              width: boxed ? item.w : undefined,
              height: boxed ? item.h : undefined,
              whiteSpace: boxed ? "normal" : "pre",
              transform: translate,
              backgroundColor: item.fill,
              display: boxed ? "flex" : undefined,
              flexDirection: "column",
              justifyContent: item.valign === "middle" ? "center" : item.valign === "bottom" ? "flex-end" : "flex-start",
              overflow: "visible",
              margin: 0,
            }}
          >
            <div>
              <DraftInline nodes={item.inline} caret={i === caretItem} />
            </div>
          </div>
        );
      })}
    </ScaledPage>
  );
}
