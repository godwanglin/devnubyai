"use client";

import React from "react";
import { BarChart3, EyeOff, Image as ImageIcon, Network, Box } from "lucide-react";
import type {
  PptxDocument,
  PptxParagraph,
  PptxShape,
  PptxSlide,
  PptxTextBody,
} from "@/lib/files/parsers/pptx";
import { useI18n } from "@/providers/i18n-provider";
import { PptxChartView } from "./pptx-chart-view";

/**
 * Slide renderer for PowerPoint decks: shapes, text, images, tables and charts
 * positioned in slide points, scaled by CSS transform.
 */

function fontStack(font: string | null): string {
  const clean = font?.replace(/["\\;]/g, "").trim();
  return clean ? `"${clean}", "Segoe UI", system-ui, sans-serif` : `"Segoe UI", system-ui, sans-serif`;
}

function boxStyle(shape: PptxShape): React.CSSProperties {
  const { box } = shape;
  const transforms: string[] = [];
  if (box.rotation) transforms.push(`rotate(${box.rotation}deg)`);
  if (shape.kind === "image") {
    if (box.flipH) transforms.push("scaleX(-1)");
    if (box.flipV) transforms.push("scaleY(-1)");
  }
  return {
    position: "absolute",
    left: box.x,
    top: box.y,
    width: box.w,
    height: box.h,
    transform: transforms.length ? transforms.join(" ") : undefined,
  };
}

function Paragraphs({ paragraphs, wrap = true }: { paragraphs: PptxParagraph[]; wrap?: boolean }) {
  return (
    <>
      {paragraphs.map((p, idx) => {
        const first = p.runs.find((r) => r.text.trim()) ?? p.runs[0];
        const isEmpty = !p.runs.some((r) => r.text.length > 0);
        return (
          <p
            key={idx}
            style={{
              margin: 0,
              marginTop: idx === 0 ? 0 : p.spaceBefore,
              marginBottom: p.spaceAfter,
              paddingLeft: p.marginLeft,
              textIndent: p.indent,
              textAlign: p.align,
              lineHeight: p.lineHeight,
              whiteSpace: wrap ? "pre-wrap" : "pre",
              overflowWrap: "break-word",
              fontSize: isEmpty ? p.emptySize : undefined,
            }}
          >
            {p.bullet && first && (
              <span
                style={{
                  display: "inline-block",
                  textIndent: 0,
                  minWidth: p.indent < 0 ? -p.indent : undefined,
                  paddingRight: p.indent < 0 ? 0 : "0.35em",
                  fontSize: first.size,
                  color: first.color,
                  fontFamily: fontStack(first.font),
                }}
              >
                {p.bullet}
              </span>
            )}
            {isEmpty
              ? "Â "
              : p.runs.map((r, ri) => (
                  <span
                    key={ri}
                    style={{
                      fontSize: r.baseline ? r.size * 0.7 : r.size,
                      verticalAlign: r.baseline > 0 ? "super" : r.baseline < 0 ? "sub" : undefined,
                      fontWeight: r.bold ? 700 : 400,
                      fontStyle: r.italic ? "italic" : undefined,
                      textDecoration:
                        [r.underline && "underline", r.strike && "line-through"].filter(Boolean).join(" ") ||
                        undefined,
                      textTransform: r.caps === "all" ? "uppercase" : undefined,
                      fontVariant: r.caps === "small" ? "small-caps" : undefined,
                      color: r.color,
                      fontFamily: fontStack(r.font),
                    }}
                  >
                    {r.text}
                  </span>
                ))}
          </p>
        );
      })}
    </>
  );
}

function TextBody({ body }: { body: PptxTextBody }) {
  const [l, t, r, b] = body.insets;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: `${t}px ${r}px ${b}px ${l}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: body.anchor === "middle" ? "center" : body.anchor === "bottom" ? "flex-end" : "flex-start",
      }}
    >
      <div>
        <Paragraphs paragraphs={body.paragraphs} wrap={body.wrap} />
      </div>
    </div>
  );
}

function EmbedPlaceholder({ label }: { label: Extract<PptxShape, { kind: "embed" }>["label"] }) {
  const { t } = useI18n();
  const Icon = label === "chart" ? BarChart3 : label === "diagram" ? Network : label === "image" ? ImageIcon : Box;
  const text =
    label === "chart"
      ? t("chatFiles.embedChart")
      : label === "diagram"
        ? t("chatFiles.embedDiagram")
        : label === "image"
          ? t("chatFiles.embedImage")
          : t("chatFiles.embedObject");
  return (
    <div
      style={{ position: "absolute", inset: 0 }}
      className="flex flex-col items-center justify-center gap-2 rounded-[6px] border-2 border-dashed border-black/15 bg-black/[0.03] text-black/45"
    >
      <Icon style={{ width: 28, height: 28 }} />
      <span style={{ fontSize: 14 }}>{text}</span>
    </div>
  );
}

function ShapeView({ shape, mediaUrls }: { shape: PptxShape; mediaUrls: Map<string, string> }) {
  const style = boxStyle(shape);

  switch (shape.kind) {
    case "shape":
      return (
        <div
          style={{
            ...style,
            background: shape.fill ?? undefined,
            border: shape.line ? `${Math.max(shape.line.width, 0.5)}px solid ${shape.line.color}` : undefined,
            boxSizing: "border-box",
            borderRadius: shape.geometry === "ellipse" ? "50%" : shape.geometry === "roundRect" ? Math.min(shape.box.w, shape.box.h) * 0.16 : 0,
          }}
        >
          {shape.text && <TextBody body={shape.text} />}
        </div>
      );

    case "image": {
      const src = mediaUrls.get(shape.mediaPath);
      return (
        <div style={style}>
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" draggable={false} style={{ width: "100%", height: "100%", display: "block" }} />
          ) : (
            <EmbedPlaceholder label="image" />
          )}
        </div>
      );
    }

    case "line": {
      const { w, h, flipH, flipV } = shape.box;
      return (
        <svg
          style={{ ...style, width: Math.max(w, 1), height: Math.max(h, 1), overflow: "visible" }}
          aria-hidden="true"
        >
          <line
            x1={flipH ? w : 0}
            y1={flipV ? h : 0}
            x2={flipH ? 0 : w}
            y2={flipV ? 0 : h}
            stroke={shape.color}
            strokeWidth={Math.max(shape.width, 0.5)}
          />
        </svg>
      );
    }

    case "table":
      return (
        <div style={style}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              {shape.columns.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <tbody>
              {shape.rows.map((row, ri) => (
                <tr key={ri} style={{ height: row.height }}>
                  {row.cells.map((cell, ci) =>
                    cell.merged ? null : (
                      <td
                        key={ci}
                        colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                        rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                        style={{
                          background: cell.fill ?? undefined,
                          border: "1px solid rgba(0,0,0,0.22)",
                          padding: "3.6px 7.2px",
                          verticalAlign: "top",
                        }}
                      >
                        <Paragraphs paragraphs={cell.paragraphs} />
                      </td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "embed":
      return (
        <div style={style}>
          <EmbedPlaceholder label={shape.label} />
        </div>
      );

    case "chart":
      // Reached only when the chart part could not be parsed
      return (
        <div style={style}>
          <EmbedPlaceholder label="chart" />
        </div>
      );
  }
}

export interface SlideCanvasProps {
  slide: PptxSlide;
  doc: PptxDocument;
  scale: number;
  mediaUrls: Map<string, string>;
}

/** The slide itself at `scale` (no frame), used by the main view and thumbnails. */
export function SlideCanvas({ slide, doc, scale, mediaUrls }: SlideCanvasProps) {
  const bgUrl = slide.background.mediaPath ? mediaUrls.get(slide.background.mediaPath) : undefined;
  return (
    <div className="relative overflow-hidden" style={{ width: doc.width * scale, height: doc.height * scale }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: doc.width,
          height: doc.height,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
          background: slide.background.fill ?? "#ffffff",
          color: "#000000",
        }}
      >
        {bgUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bgUrl}
            alt=""
            draggable={false}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
        {slide.shapes.map((shape, idx) => {
          if (shape.kind === "chart") {
            const chart = doc.charts.get(shape.chartPath);
            if (chart) {
              return (
                <div key={idx} style={{ position: "absolute", left: shape.box.x, top: shape.box.y, width: shape.box.w, height: shape.box.h }}>
                  <PptxChartView chart={chart} width={shape.box.w} height={shape.box.h} />
                </div>
              );
            }
          }
          return <ShapeView key={idx} shape={shape} mediaUrls={mediaUrls} />;
        })}
      </div>
    </div>
  );
}

/** A slide in the continuous deck view: framed canvas, number caption and speaker notes. */
export function SlideView({ slide, doc, scale, mediaUrls }: SlideCanvasProps) {
  const { t } = useI18n();
  const scaledHeight = doc.height * scale;

  return (
    <figure
      className="m-0"
      style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${Math.round(scaledHeight + 28)}px` }}
    >
      <div
        className="rounded-[8px] overflow-hidden ring-1 ring-black/10 shadow-[0_4px_18px_rgba(0,0,0,0.18)] select-text"
        style={{ width: doc.width * scale, opacity: slide.hidden ? 0.55 : 1 }}
      >
        <SlideCanvas slide={slide} doc={doc} scale={scale} mediaUrls={mediaUrls} />
      </div>

      <figcaption className="mt-2 flex items-center gap-2 text-[11.5px] text-[var(--muted)] select-none">
        <span className="font-mono tabular-nums">{slide.number}</span>
        {slide.hidden && (
          <span className="inline-flex items-center gap-1 text-[var(--placeholder)]">
            <EyeOff className="w-3 h-3" />
            {t("chatFiles.hiddenSlide")}
          </span>
        )}
      </figcaption>

      {slide.notes && (
        <details className="mt-1.5 group">
          <summary className="cursor-pointer select-none text-[11.5px] text-[var(--placeholder)] hover:text-[var(--muted)] transition-colors">
            {t("chatFiles.speakerNotes")}
          </summary>
          <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--muted)]">
            {slide.notes}
          </p>
        </details>
      )}
    </figure>
  );
}

