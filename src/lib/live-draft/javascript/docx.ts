import { fontFamilyOf, fontKindOf, normalizeColor, plainInline } from "../common";
import { A4, DEFAULT_TEXT_STYLE, DRAFT_LIMITS, type DraftBlock, type DraftPageSize, type DraftTableCell, type DraftTextStyle, type InlineNode } from "../types";
import { jsIncomplete, jsText, prop, propBool, propNumber, propText, type JsVal } from "./values";

/** `docx` (npm) documents: Paragraph / TextRun / Table instances → draft blocks. */

export const DOCX_CLASSES = new Set(["Paragraph", "TextRun", "Table", "TableRow", "TableCell", "PageBreak", "ImageRun", "ExternalHyperlink", "InternalHyperlink", "Document", "Tab", "SymbolRun", "Bookmark"]);

const TWIP = 1 / 20;

export interface DocxDefaults {
  font?: string;
  size?: number;
  headings: Map<string, { size?: number; bold?: boolean; italic?: boolean; color?: string; font?: string; before?: number; after?: number }>;
}

const HEADING_SIZES: Record<string, number> = { Title: 26, Heading1: 16, Heading2: 13, Heading3: 12, Heading4: 11, Heading5: 11, Heading6: 11 };

function headingId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.replace(/^HeadingLevel\./, "");
  if (/^title$/i.test(v)) return "Title";
  const m = /(\d)/.exec(v);
  if (/heading/i.test(v) && m) return `Heading${m[1]}`;
  return /^Heading\d$/.test(v) ? v : undefined;
}

function alignOf(value: string | undefined): DraftTextStyle["align"] {
  const v = (value ?? "").toLowerCase();
  if (v.includes("center")) return "center";
  if (v.includes("right") || v === "end") return "right";
  if (v.includes("both") || v.includes("justif") || v.includes("distribute")) return "justify";
  return "left";
}

/** Defaults from `new Document({ styles: { default, paragraphStyles } })`. */
export function readDocxDefaults(opts: JsVal | undefined): DocxDefaults {
  const styles = prop(opts, "styles");
  const run = prop(prop(prop(styles, "default"), "document"), "run");
  const fontVal = prop(run, "font");
  const defaults: DocxDefaults = {
    font: fontVal?.t === "obj" ? propText(fontVal, "name") : propText(run, "font"),
    size: propNumber(run, "size"),
    headings: new Map(),
  };
  const paragraphStyles = prop(styles, "paragraphStyles");
  const headingDefaults = prop(styles, "default");
  const register = (id: string | undefined, def: JsVal | undefined) => {
    if (!id || !def) return;
    const r = prop(def, "run");
    const spacing = prop(prop(def, "paragraph"), "spacing");
    const f = prop(r, "font");
    defaults.headings.set(id, {
      size: propNumber(r, "size"),
      bold: propBool(r, "bold"),
      italic: propBool(r, "italics"),
      color: normalizeColor(propText(r, "color")),
      font: f?.t === "obj" ? propText(f, "name") : propText(r, "font"),
      before: propNumber(spacing, "before"),
      after: propNumber(spacing, "after"),
    });
  };
  if (paragraphStyles?.t === "arr") for (const def of paragraphStyles.items) register(propText(def, "id"), def);
  if (headingDefaults?.t === "obj") headingDefaults.props.forEach((def, key) => register(headingId(key) ?? (key === "title" ? "Title" : undefined), def));
  return defaults;
}

function runToInline(run: JsVal, out: InlineNode[]): void {
  if (run.t === "str") {
    out.push({ kind: "text", text: run.v });
    return;
  }
  if (run.t !== "inst") return;
  const opts = run.args[0];
  if (run.cls === "PageBreak") return;
  if (run.cls === "ExternalHyperlink" || run.cls === "InternalHyperlink") {
    const children: InlineNode[] = [];
    const kids = prop(opts, "children");
    if (kids?.t === "arr") kids.items.forEach((k) => runToInline(k, children));
    out.push({ kind: "span", underline: true, color: "#2563eb", children });
    return;
  }
  if (run.cls === "Tab") {
    out.push({ kind: "text", text: " " });
    return;
  }
  if (run.cls !== "TextRun" && run.cls !== "SymbolRun") return;
  const text = opts?.t === "str" ? opts.v : jsText(prop(opts, "text") ?? { t: "str", v: "", complete: true });
  const breaks = Math.min(5, propNumber(opts, "break") ?? 0);
  for (let i = 0; i < breaks; i += 1) out.push({ kind: "br" });
  if (opts?.t === "str") {
    out.push({ kind: "text", text });
    return;
  }
  const font = prop(opts, "font");
  const size = propNumber(opts, "size");
  const underline = prop(opts, "underline");
  out.push({
    kind: "span",
    bold: propBool(opts, "bold"),
    italic: propBool(opts, "italics"),
    underline: underline !== undefined && underline.t !== "nil",
    strike: propBool(opts, "strike"),
    script: propBool(opts, "superScript") ? "sup" : propBool(opts, "subScript") ? "sub" : undefined,
    color: normalizeColor(propText(opts, "color")),
    fontSize: size ? size / 2 : undefined,
    fontFamily: font?.t === "obj" ? propText(font, "name") : propText(opts, "font"),
    background: normalizeColor(propText(prop(opts, "shading"), "fill")),
    children: [{ kind: "text", text: propBool(opts, "allCaps") ? text.toUpperCase() : text }],
  });
}

interface DocxContext {
  defaults: DocxDefaults;
  numbering: Map<string, number>;
  out: DraftBlock[];
}

function paragraphStyle(opts: JsVal | undefined, ctx: DocxContext): { style: DraftTextStyle; heading?: string } {
  const heading = headingId(propText(opts, "heading") ?? propText(opts, "style"));
  const custom = heading ? ctx.defaults.headings.get(heading) : undefined;
  const baseSize = (ctx.defaults.size ?? 22) / 2;
  const fontSize = custom?.size ? custom.size / 2 : heading ? HEADING_SIZES[heading] ?? baseSize : baseSize;
  const fontName = fontFamilyOf(custom?.font ?? ctx.defaults.font ?? "Calibri");
  const spacing = prop(opts, "spacing");
  const indent = prop(opts, "indent");
  const line = propNumber(spacing, "line");
  return {
    heading,
    style: {
      ...DEFAULT_TEXT_STYLE,
      fontName,
      fontKind: fontKindOf(fontName),
      fontSize,
      leading: fontSize * (line ? line / 240 : 1.15) * 1.08,
      bold: custom?.bold ?? Boolean(heading),
      italic: custom?.italic ?? false,
      color: custom?.color ?? (heading && heading !== "Title" ? "#2f5496" : undefined),
      align: alignOf(propText(opts, "alignment")),
      background: normalizeColor(propText(prop(opts, "shading"), "fill")),
      spaceBefore: (propNumber(spacing, "before") ?? custom?.before ?? (heading ? 240 : 0)) * TWIP,
      spaceAfter: (propNumber(spacing, "after") ?? custom?.after ?? (heading ? 80 : 160)) * TWIP,
      leftIndent: (propNumber(indent, "left") ?? 0) * TWIP,
      rightIndent: (propNumber(indent, "right") ?? 0) * TWIP,
      firstLineIndent: ((propNumber(indent, "firstLine") ?? 0) - (propNumber(indent, "hanging") ?? 0)) * TWIP,
    },
  };
}

function paragraphBlocks(par: JsVal & { t: "inst" }, ctx: DocxContext): void {
  const opts = par.args[0];
  if (opts?.t === "str") {
    ctx.out.push({ type: "text", inline: plainInline(opts.v), style: paragraphStyle(undefined, ctx).style, typing: !opts.complete });
    return;
  }
  if (propBool(opts, "pageBreakBefore")) ctx.out.push({ type: "pagebreak" });
  const { style } = paragraphStyle(opts, ctx);
  const inline: InlineNode[] = [];
  const text = prop(opts, "text");
  if (text) inline.push({ kind: "text", text: jsText(text) });
  const children = prop(opts, "children");
  let pageBreakAfter = false;
  let image: string | null = null;
  if (children?.t === "arr") {
    for (const child of children.items) {
      if (child.t === "inst" && child.cls === "PageBreak") pageBreakAfter = true;
      else if (child.t === "inst" && child.cls === "ImageRun") image = "image";
      else runToInline(child, inline);
    }
  }
  let bullet: string | undefined;
  const bulletOpt = prop(opts, "bullet");
  const numbering = prop(opts, "numbering");
  if (bulletOpt) bullet = "•";
  else if (numbering?.t === "obj") {
    const ref = `${propText(numbering, "reference") ?? ""}:${propNumber(numbering, "level") ?? 0}`;
    const next = (ctx.numbering.get(ref) ?? 0) + 1;
    ctx.numbering.set(ref, next);
    bullet = /bullet/i.test(ref) ? "•" : `${next}.`;
  }
  if (image) ctx.out.push({ type: "image", label: image });
  if (inline.length > 0 || !pageBreakAfter) {
    ctx.out.push({ type: "text", inline, style, bullet, typing: jsIncomplete(text) || (children?.t === "arr" && children.items.some(jsIncomplete)) });
  }
  if (pageBreakAfter) ctx.out.push({ type: "pagebreak" });
}

function cellOf(cell: JsVal, ctx: DocxContext, header: boolean): DraftTableCell {
  if (cell.t !== "inst") return { inline: plainInline(jsText(cell)) };
  const opts = cell.args[0];
  const nested: DraftBlock[] = [];
  const kids = prop(opts, "children");
  if (kids?.t === "arr") for (const kid of kids.items) convertDocx(kid, { ...ctx, out: nested });
  const inline: InlineNode[] = [];
  nested.forEach((b, i) => {
    if (b.type !== "text") return;
    if (i > 0) inline.push({ kind: "br" });
    inline.push(...b.inline);
  });
  const first = nested.find((b) => b.type === "text");
  return {
    inline,
    bold: header || (first?.type === "text" && first.style.bold),
    background: normalizeColor(propText(prop(opts, "shading"), "fill")),
    align: first?.type === "text" && first.style.align !== "justify" ? first.style.align : undefined,
  };
}

function tableBlock(table: JsVal & { t: "inst" }, ctx: DocxContext): void {
  const opts = table.args[0];
  const rows = prop(opts, "rows");
  if (rows?.t !== "arr") return;
  const cells = rows.items.slice(0, DRAFT_LIMITS.tableRows).map((row) => {
    const rowOpts = row.t === "inst" ? row.args[0] : undefined;
    const header = propBool(rowOpts, "tableHeader") ?? false;
    const kids = prop(rowOpts, "children");
    return kids?.t === "arr" ? kids.items.map((cell) => cellOf(cell, ctx, header)) : [];
  });
  const widths = prop(opts, "columnWidths");
  const headerBg = cells[0]?.find((c) => c.background)?.background;
  ctx.out.push({
    type: "table",
    rows: cells,
    colWidths: widths?.t === "arr" ? widths.items.map((w) => (w.t === "num" ? w.v * TWIP : 0)) : undefined,
    headerBackground: headerBg,
    fontSize: (ctx.defaults.size ?? 22) / 2,
    fontKind: fontKindOf(ctx.defaults.font),
    fontName: fontFamilyOf(ctx.defaults.font ?? "Calibri"),
    gridColor: "#bfbfbf",
    typing: rows.items.some(jsIncomplete),
  });
}

export function convertDocx(value: JsVal, ctx: DocxContext): void {
  if (ctx.out.length >= DRAFT_LIMITS.blocks) return;
  if (value.t === "arr") {
    value.items.forEach((item) => convertDocx(item, ctx));
    return;
  }
  if (value.t !== "inst") return;
  if (value.cls === "Paragraph") paragraphBlocks(value, ctx);
  else if (value.cls === "Table") tableBlock(value, ctx);
}

export function docxBlocks(children: JsVal[], defaults: DocxDefaults): DraftBlock[] {
  const ctx: DocxContext = { defaults, numbering: new Map(), out: [] };
  for (const child of children) convertDocx(child, ctx);
  return ctx.out;
}

/** Page size and margins of a docx section (twips → points); A4 by default. */
export function docxPage(section: JsVal | undefined): DraftPageSize {
  const page = prop(prop(section, "properties"), "page");
  const size = prop(page, "size");
  const margin = prop(page, "margin");
  let width = (propNumber(size, "width") ?? 11906) * TWIP;
  let height = (propNumber(size, "height") ?? 16838) * TWIP;
  if (/landscape/i.test(propText(size, "orientation") ?? "") && width < height) [width, height] = [height, width];
  const m = (key: string) => (propNumber(margin, key) ?? 1440) * TWIP;
  return {
    width: width > 50 ? width : A4[0],
    height: height > 50 ? height : A4[1],
    margins: { top: m("top"), right: m("right"), bottom: m("bottom"), left: m("left") },
  };
}
