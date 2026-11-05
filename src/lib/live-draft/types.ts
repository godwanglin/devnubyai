/**
 * Live draft: an approximate, page-shaped picture of a document while the AI is still
 * writing the code that builds it (reportlab / openpyxl in Python, `docx` / pptxgenjs in
 * Node, or the structured input of create_document & co). It is drawn in the files panel
 * until the real file exists. Everything here is plain data: no HTML strings, so nothing
 * from the AI's code can ever be injected into the page.
 */

/** Inline rich text (reportlab mini-markup, docx runs, pptx runs). */
export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "br" }
  | {
      kind: "span";
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      strike?: boolean;
      script?: "sup" | "sub";
      color?: string;
      fontSize?: number;
      fontFamily?: string;
      background?: string;
      children: InlineNode[];
    };

export type FontKind = "serif" | "sans" | "mono";

export interface DraftTextStyle {
  /** Font family name as written in the code (e.g. "Lato"), used first in the CSS stack */
  fontName?: string;
  fontKind: FontKind;
  /** Points */
  fontSize: number;
  /** Line height in points */
  leading: number;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right" | "justify";
  color?: string;
  background?: string;
  spaceBefore: number;
  spaceAfter: number;
  leftIndent: number;
  rightIndent: number;
  firstLineIndent: number;
}

export type DraftBlock =
  | {
      type: "text";
      inline: InlineNode[];
      style: DraftTextStyle;
      /** Bullet or number shown in the left gutter */
      bullet?: string;
      /** Its text is still being written */
      typing?: boolean;
      mono?: boolean;
    }
  | { type: "spacer"; height: number }
  | { type: "pagebreak" }
  | { type: "rule"; color?: string; thickness: number; spaceBefore: number; spaceAfter: number; widthPercent: number }
  | {
      type: "table";
      rows: DraftTableCell[][];
      colWidths?: number[];
      headerBackground?: string;
      headerColor?: string;
      gridColor?: string;
      zebra?: string;
      fontSize: number;
      fontKind: FontKind;
      fontName?: string;
      typing?: boolean;
    }
  | { type: "image"; label: string; width?: number; height?: number }
  | {
      type: "callout";
      title?: string;
      inline: InlineNode[];
      accent: string;
      typing?: boolean;
    };

export interface DraftTableCell {
  inline: InlineNode[];
  bold?: boolean;
  align?: "left" | "center" | "right";
  background?: string;
  color?: string;
}

export interface DraftPageSize {
  /** Points */
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
}

/** Absolutely placed item on a fixed page (canvas drawing, pptx slide). Points, top-left origin. */
export type FixedItem =
  | {
      type: "text";
      x: number;
      y: number;
      /** Box width for wrapped text (pptx); absent for single-line canvas strings */
      w?: number;
      h?: number;
      anchor: "start" | "middle" | "end";
      valign?: "top" | "middle" | "bottom";
      inline: InlineNode[];
      style: DraftTextStyle;
      fill?: string;
      typing?: boolean;
    }
  | {
      type: "shape";
      shape: "rect" | "ellipse" | "line";
      x: number;
      y: number;
      w: number;
      h: number;
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
      radius?: number;
    }
  | { type: "image"; x: number; y: number; w: number; h: number; label: string }
  | { type: "flow"; x: number; y: number; w: number; h?: number; anchorBottom?: boolean; blocks: DraftBlock[] };

export interface DraftSheet {
  name: string;
  /** cells[row][col], 0-based */
  cells: (string | null)[][];
  bold: boolean[][];
  colWidths: number[];
  typing?: boolean;
}

export type DraftSection =
  | { kind: "flow"; page: DraftPageSize; blocks: DraftBlock[] }
  | { kind: "fixed"; page: DraftPageSize; background?: string; items: FixedItem[] }
  | { kind: "sheets"; sheets: DraftSheet[] }
  | { kind: "markdown"; text: string; typing?: boolean }
  | { kind: "html"; html: string };

export interface DraftDocument {
  sections: DraftSection[];
  /** Something on the last page is still being typed */
  typing: boolean;
}

export const POINTS_PER_INCH = 72;
export const A4: [number, number] = [595.2756, 841.8898];
export const LETTER: [number, number] = [612, 792];

export const DEFAULT_TEXT_STYLE: DraftTextStyle = {
  fontName: "Helvetica",
  fontKind: "sans",
  fontSize: 10,
  leading: 12,
  bold: false,
  italic: false,
  align: "left",
  spaceBefore: 0,
  spaceAfter: 0,
  leftIndent: 0,
  rightIndent: 0,
  firstLineIndent: 0,
};

/** Caps that keep a runaway script from building a huge draft. */
export const DRAFT_LIMITS = {
  blocks: 3000,
  fixedItems: 4000,
  sections: 80,
  sheetRows: 300,
  sheetCols: 40,
  tableRows: 400,
};
