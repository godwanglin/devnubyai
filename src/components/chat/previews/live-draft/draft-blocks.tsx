"use client";

import React from "react";
import { ImageIcon } from "lucide-react";
import { cssFontFamily } from "@/lib/live-draft/common";
import type { DraftBlock, DraftTextStyle } from "@/lib/live-draft/types";
import { DraftInline } from "./draft-inline";

/** CSS for a draft text style; 1 point is drawn as 1 CSS pixel (the page is scaled as a whole). */
export function textCss(style: DraftTextStyle, mono = false): React.CSSProperties {
  return {
    fontFamily: cssFontFamily(style.fontName, mono ? "mono" : style.fontKind),
    fontSize: `${style.fontSize}px`,
    lineHeight: `${Math.max(style.leading, style.fontSize)}px`,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    textAlign: style.align,
    textAlignLast: style.align === "justify" ? "left" : undefined,
    color: style.color ?? "#111111",
    backgroundColor: style.background,
    marginLeft: `${style.leftIndent}px`,
    marginRight: `${style.rightIndent}px`,
    textIndent: style.firstLineIndent ? `${style.firstLineIndent}px` : undefined,
    whiteSpace: mono ? "pre-wrap" : "normal",
    overflowWrap: "break-word",
  };
}

/** Space a block takes above and below its content (kept apart from the content for pagination). */
export function blockSpacing(block: DraftBlock): { before: number; after: number } {
  if (block.type === "text") return { before: block.style.spaceBefore, after: block.style.spaceAfter };
  if (block.type === "rule") return { before: block.spaceBefore, after: block.spaceAfter };
  if (block.type === "table") return { before: 4, after: 8 };
  if (block.type === "image" || block.type === "callout") return { before: 4, after: 8 };
  return { before: 0, after: 0 };
}

/** Line height used to snap page breaks inside a tall block. */
export function blockLineHeight(block: DraftBlock): number {
  if (block.type === "text") return Math.max(block.style.leading, block.style.fontSize);
  if (block.type === "table") return block.fontSize * 1.9;
  return 0;
}

export function DraftBlockView({ block, caret }: { block: DraftBlock; caret: boolean }) {
  switch (block.type) {
    case "text": {
      const css = textCss(block.style, block.mono);
      if (!block.bullet) {
        return (
          <div style={css}>
            <DraftInline nodes={block.inline} caret={caret} />
            {block.inline.length === 0 && !caret ? " " : null}
          </div>
        );
      }
      const gutter = Math.max(14, block.style.fontSize * 1.3);
      return (
        <div style={{ ...css, position: "relative", paddingLeft: `${gutter}px`, textIndent: undefined }}>
          <span style={{ position: "absolute", left: 0, top: 0, width: `${gutter}px` }}>{block.bullet}</span>
          <DraftInline nodes={block.inline} caret={caret} />
        </div>
      );
    }
    case "spacer":
      return <div style={{ height: `${block.height}px` }} />;
    case "pagebreak":
      return <div />;
    case "rule":
      return (
        <div
          style={{
            height: `${block.thickness}px`,
            width: `${block.widthPercent}%`,
            margin: "0 auto",
            backgroundColor: block.color ?? "#9ca3af",
          }}
        />
      );
    case "image":
      return (
        <div
          className="flex flex-col items-center justify-center gap-1.5 rounded-[4px] border border-dashed border-[#cbd5e1] bg-[#f1f5f9] text-[#64748b]"
          style={{ width: block.width ? `${block.width}px` : "100%", maxWidth: "100%", height: `${block.height ?? 140}px`, margin: "0 auto" }}
        >
          <ImageIcon className="w-6 h-6" />
          <span className="text-[10px] font-sans truncate max-w-[90%]">{block.label}</span>
        </div>
      );
    case "callout":
      return (
        <div
          style={{
            borderLeft: `3px solid ${block.accent}`,
            backgroundColor: `${block.accent}14`,
            padding: "8px 12px",
            fontFamily: cssFontFamily("Arial", "sans"),
            fontSize: "11px",
            lineHeight: "16px",
            color: "#111111",
          }}
        >
          {block.title ? <div style={{ fontWeight: 700, marginBottom: 2 }}>{block.title}</div> : null}
          <DraftInline nodes={block.inline} caret={caret} />
        </div>
      );
    case "table":
      return <DraftTable block={block} caret={caret} />;
  }
}

/** Word's "auto" text color: white on dark shading. */
function isDark(color: string | undefined): boolean {
  const hex = /^#([0-9a-f]{6})/i.exec(color ?? "")?.[1];
  if (!hex) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

function DraftTable({ block, caret }: { block: Extract<DraftBlock, { type: "table" }>; caret: boolean }) {
  const border = `0.75px solid ${block.gridColor ?? "#9ca3af"}`;
  const totalWidth = block.colWidths?.reduce((sum, w) => sum + w, 0);
  const lastRow = block.rows.length - 1;
  return (
    <table
      style={{
        borderCollapse: "collapse",
        width: totalWidth ? `${totalWidth}px` : "100%",
        maxWidth: "100%",
        tableLayout: block.colWidths ? "fixed" : "auto",
        fontFamily: cssFontFamily(block.fontName, block.fontKind),
        fontSize: `${block.fontSize}px`,
        lineHeight: `${block.fontSize * 1.3}px`,
        color: "#111111",
      }}
    >
      {block.colWidths ? (
        <colgroup>
          {block.colWidths.map((w, i) => (
            <col key={i} style={{ width: `${w}px` }} />
          ))}
        </colgroup>
      ) : null}
      <tbody>
        {block.rows.map((row, r) => {
          const rowBackground = r === 0 && block.headerBackground ? block.headerBackground : block.zebra && r % 2 === 0 && r > 0 ? block.zebra : undefined;
          const rowColor = r === 0 && block.headerColor ? block.headerColor : isDark(rowBackground) ? "#ffffff" : undefined;
          return (
            <tr key={r} style={{ backgroundColor: rowBackground, color: rowColor }}>
              {row.map((cell, c) => (
                <td
                  key={c}
                  style={{
                    border,
                    padding: "3px 5px",
                    verticalAlign: "top",
                    fontWeight: cell.bold ? 700 : undefined,
                    textAlign: cell.align,
                    backgroundColor: cell.background,
                    color: cell.color ?? (isDark(cell.background) ? "#ffffff" : undefined),
                    overflowWrap: "anywhere",
                  }}
                >
                  <DraftInline nodes={cell.inline} caret={caret && r === lastRow && c === row.length - 1} />
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
