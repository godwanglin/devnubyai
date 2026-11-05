import { fontFamilyOf, fontKindOf, normalizeColor } from "../common";
import { DEFAULT_TEXT_STYLE, DRAFT_LIMITS, POINTS_PER_INCH, type DraftPageSize, type DraftTableCell, type FixedItem, type InlineNode } from "../types";
import { jsIncomplete, jsNumber, jsText, prop, propBool, propNumber, propText, type JsVal } from "./values";

/** pptxgenjs presentations: slides with positioned text, shapes, images and tables. */

const LAYOUTS: Record<string, [number, number]> = {
  LAYOUT_16x9: [10, 5.625],
  LAYOUT_16x10: [10, 6.25],
  LAYOUT_4x3: [10, 7.5],
  LAYOUT_WIDE: [13.333, 7.5],
};

export interface PptxState {
  size: [number, number];
  customLayouts: Map<string, [number, number]>;
  slides: SlideState[];
}

export interface SlideState {
  background?: string;
  items: FixedItem[];
}

export function newPresentation(): PptxState {
  return { size: LAYOUTS.LAYOUT_16x9, customLayouts: new Map(), slides: [] };
}

export function setLayout(state: PptxState, value: JsVal): void {
  const name = jsText(value);
  state.size = LAYOUTS[name] ?? state.customLayouts.get(name) ?? state.size;
}

export function defineLayout(state: PptxState, opts: JsVal | undefined): void {
  const name = propText(opts, "name");
  const w = propNumber(opts, "width");
  const h = propNumber(opts, "height");
  if (name && w && h && w > 0 && h > 0) state.customLayouts.set(name, [w, h]);
}

export function slidePage(state: PptxState): DraftPageSize {
  return { width: state.size[0] * POINTS_PER_INCH, height: state.size[1] * POINTS_PER_INCH, margins: { top: 0, right: 0, bottom: 0, left: 0 } };
}

/** pptx coordinates: inches, or "50%" of the slide side. */
function coord(value: JsVal | undefined, side: number, fallback: number): number {
  if (!value) return fallback * POINTS_PER_INCH;
  if (value.t === "str" && value.v.trim().endsWith("%")) return (parseFloat(value.v) / 100) * side * POINTS_PER_INCH;
  const n = jsNumber(value, NaN);
  return Number.isFinite(n) ? n * POINTS_PER_INCH : fallback * POINTS_PER_INCH;
}

function box(state: PptxState, opts: JsVal | undefined, fallback: [number, number, number, number]) {
  const [W, H] = state.size;
  return {
    x: coord(prop(opts, "x"), W, fallback[0]),
    y: coord(prop(opts, "y"), H, fallback[1]),
    w: coord(prop(opts, "w"), W, fallback[2]),
    h: coord(prop(opts, "h"), H, fallback[3]),
  };
}

function colorOf(value: JsVal | undefined): string | undefined {
  if (!value) return undefined;
  if (value.t === "obj") return normalizeColor(propText(value, "color"));
  return normalizeColor(jsText(value));
}

function pushItem(slide: SlideState, item: FixedItem): void {
  if (slide.items.length < DRAFT_LIMITS.fixedItems) slide.items.push(item);
}

function runs(text: JsVal | undefined, base: JsVal | undefined): InlineNode[] {
  if (!text) return [];
  if (text.t !== "arr") {
    const bullet = prop(base, "bullet");
    const hasBullet = bullet !== undefined && bullet.t !== "nil" && !(bullet.t === "bool" && !bullet.v);
    return [{ kind: "text", text: `${hasBullet ? "• " : ""}${jsText(text)}` }];
  }
  const out: InlineNode[] = [];
  text.items.forEach((run, i) => {
    const runText = run.t === "obj" ? jsText(prop(run, "text")) : jsText(run);
    const opts = run.t === "obj" ? prop(run, "options") : undefined;
    const bullet = prop(opts, "bullet") ?? prop(base, "bullet");
    const hasBullet = bullet !== undefined && bullet.t !== "nil" && !(bullet.t === "bool" && !bullet.v);
    const previous = i > 0 && text.items[i - 1].t === "obj" ? prop(text.items[i - 1], "options") : undefined;
    if (i > 0 && (propBool(previous, "breakLine") || hasBullet || propBool(base, "breakLine"))) out.push({ kind: "br" });
    out.push({
      kind: "span",
      bold: propBool(opts, "bold"),
      italic: propBool(opts, "italic"),
      underline: propBool(opts, "underline"),
      color: colorOf(prop(opts, "color")),
      fontSize: propNumber(opts, "fontSize"),
      fontFamily: propText(opts, "fontFace"),
      children: [{ kind: "text", text: `${hasBullet ? "• " : ""}${runText}` }],
    });
  });
  return out;
}

export function addText(state: PptxState, slide: SlideState, text: JsVal | undefined, opts: JsVal | undefined): void {
  const { x, y, w, h } = box(state, opts, [0.5, 0.5, state.size[0] - 1, 1]);
  const fontSize = propNumber(opts, "fontSize") ?? 18;
  const fontName = fontFamilyOf(propText(opts, "fontFace") ?? "Arial");
  const align = (propText(opts, "align") ?? "left").toLowerCase();
  const valign = (propText(opts, "valign") ?? "top").toLowerCase();
  pushItem(slide, {
    type: "text",
    x,
    y,
    w,
    h,
    anchor: "start",
    valign: valign === "middle" || valign === "center" ? "middle" : valign === "bottom" ? "bottom" : "top",
    inline: runs(text, opts),
    style: {
      ...DEFAULT_TEXT_STYLE,
      fontName,
      fontKind: fontKindOf(fontName),
      fontSize,
      leading: fontSize * (propNumber(opts, "lineSpacingMultiple") ?? 1.15),
      bold: propBool(opts, "bold") ?? false,
      italic: propBool(opts, "italic") ?? false,
      align: align === "center" ? "center" : align === "right" ? "right" : align === "justify" ? "justify" : "left",
      color: colorOf(prop(opts, "color")) ?? "#000000",
    },
    fill: colorOf(prop(opts, "fill")),
    typing: jsIncomplete(text) || (text?.t === "arr" && text.items.some((r) => jsIncomplete(r.t === "obj" ? prop(r, "text") : r))),
  });
}

export function addShape(state: PptxState, slide: SlideState, shape: JsVal | undefined, opts: JsVal | undefined): void {
  const { x, y, w, h } = box(state, opts, [0, 0, 1, 1]);
  const kind = jsText(shape).toLowerCase();
  const line = prop(opts, "line");
  pushItem(slide, {
    type: "shape",
    shape: kind.includes("ellipse") || kind.includes("oval") ? "ellipse" : kind.includes("line") ? "line" : "rect",
    x,
    y,
    w,
    h,
    radius: kind.includes("round") ? (propNumber(opts, "rectRadius") ?? 0.1) * POINTS_PER_INCH : 0,
    fill: colorOf(prop(opts, "fill")),
    stroke: colorOf(line),
    strokeWidth: propNumber(line, "width") ?? 1,
  });
}

export function addImage(state: PptxState, slide: SlideState, opts: JsVal | undefined, label = "image"): void {
  const { x, y, w, h } = box(state, opts, [1, 1, 3, 2]);
  const path = propText(opts, "path");
  pushItem(slide, { type: "image", x, y, w, h, label: path ? path.split(/[\\/]/).pop() ?? label : label });
}

export function addTable(state: PptxState, slide: SlideState, rows: JsVal | undefined, opts: JsVal | undefined): void {
  if (rows?.t !== "arr") return;
  const { x, y, w } = box(state, opts, [0.5, 1, state.size[0] - 1, 1]);
  const cells: DraftTableCell[][] = rows.items.slice(0, DRAFT_LIMITS.tableRows).map((row) =>
    (row.t === "arr" ? row.items : [row]).map((cell) => {
      const cellOpts = cell.t === "obj" ? prop(cell, "options") : undefined;
      return {
        inline: [{ kind: "text", text: cell.t === "obj" ? jsText(prop(cell, "text")) : jsText(cell) }],
        bold: propBool(cellOpts, "bold"),
        background: colorOf(prop(cellOpts, "fill")),
        color: colorOf(prop(cellOpts, "color")),
      };
    })
  );
  const fontSize = propNumber(opts, "fontSize") ?? 12;
  pushItem(slide, {
    type: "flow",
    x,
    y,
    w,
    blocks: [{ type: "table", rows: cells, fontSize, fontKind: "sans", fontName: fontFamilyOf(propText(opts, "fontFace")), gridColor: colorOf(prop(opts, "border")) ?? "#bfbfbf" }],
  });
}

export function setBackground(slide: SlideState, value: JsVal): void {
  slide.background = colorOf(value.t === "obj" ? (prop(value, "fill") ?? prop(value, "color") ?? value) : value) ?? slide.background;
}
