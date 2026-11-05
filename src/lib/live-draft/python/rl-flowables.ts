import { inlineText, parseInlineMarkup, plainInline } from "../common";
import { DRAFT_LIMITS, type DraftBlock, type DraftTableCell } from "../types";
import { colorOf, resolveTextStyle, styleProp, type FontRegistry } from "./rl-styles";
import { isIncomplete, isObj, iterItems, obj, toNumber, toText, type PyVal } from "./values";

export const FLOWABLE_CLASSES = new Set([
  "paragraph", "spacer", "pagebreak", "hr", "table", "image", "list", "keep", "preformatted",
]);

export function isFlowable(value: PyVal): boolean {
  return value.t === "obj" && FLOWABLE_CLASSES.has(value.cls);
}

/** Commands of a `TableStyle([...])` or a plain command list. */
export function tableStyleCommands(value: PyVal | undefined): PyVal[] {
  if (!value) return [];
  if (isObj(value, "tablestyle")) return iterItems((value.props.cmds as PyVal) ?? { t: "unknown" }) ?? [];
  return iterItems(value) ?? [];
}

/** Constructors of platypus flowables; null when `name` is not one. */
export function makeFlowable(name: string, args: PyVal[], kw: Map<string, PyVal>): PyVal | null {
  const arg = (i: number, key: string) => kw.get(key) ?? args[i];
  switch (name) {
    case "Paragraph":
      return obj("paragraph", {
        text: arg(0, "text"),
        style: arg(1, "style"),
        bulletText: arg(2, "bulletText"),
        typing: isIncomplete(arg(0, "text")),
      });
    case "Preformatted":
    case "XPreformatted":
      return obj("preformatted", { text: arg(0, "text"), style: arg(1, "style"), typing: isIncomplete(arg(0, "text")) });
    case "Spacer":
      return obj("spacer", { height: toNumber(arg(1, "height"), 6) });
    case "PageBreak":
    case "PageBreakIfNotEmpty":
    case "NextPageTemplate":
      return name === "NextPageTemplate" ? obj("noop") : obj("pagebreak");
    case "CondPageBreak":
    case "FrameBreak":
      return obj("noop");
    case "HRFlowable":
    case "HorizontalLine": {
      const width = kw.get("width") ?? args[0];
      const widthPercent = width?.t === "str" && width.v.endsWith("%") ? parseFloat(width.v) : 100;
      return obj("hr", {
        thickness: toNumber(kw.get("thickness"), 1),
        color: colorOf(kw.get("color")),
        spaceBefore: toNumber(kw.get("spaceBefore"), 1),
        spaceAfter: toNumber(kw.get("spaceAfter"), 1),
        widthPercent: Number.isFinite(widthPercent) ? widthPercent : 100,
      });
    }
    case "Table":
    case "LongTable":
      return obj("table", { data: arg(0, "data"), colWidths: arg(1, "colWidths"), cmds: tableStyleCommands(kw.get("style")) });
    case "TableStyle":
      return obj("tablestyle", { cmds: args[0] });
    case "Image":
    case "RLImage": {
      const source = arg(0, "filename");
      return obj("image", {
        label: source?.t === "str" ? source.v.split(/[\\/]/).pop() : "image",
        width: toNumber(arg(1, "width"), 0) || undefined,
        height: toNumber(arg(2, "height"), 0) || undefined,
      });
    }
    case "ListFlowable":
      return obj("list", { items: arg(0, "flowables"), bulletType: kw.get("bulletType"), start: kw.get("start") });
    case "ListItem":
      return obj("listitem", { item: args[0], value: kw.get("value") });
    case "KeepTogether":
    case "KeepInFrame":
      return obj("keep", { items: kw.get("content") ?? (name === "KeepInFrame" ? args[2] : args[0]) });
    default:
      return null;
  }
}

interface ConvertContext {
  registry: FontRegistry;
  out: DraftBlock[];
}

function paragraphBlock(value: PyVal & { t: "obj" }, ctx: ConvertContext, bullet?: string): DraftBlock {
  const style = resolveTextStyle(value.props.style as PyVal | undefined, ctx.registry);
  const textVal = value.props.text as PyVal | undefined;
  const isPre = value.cls === "preformatted";
  const inline = isPre ? plainInline(toText(textVal)) : parseInlineMarkup(toText(textVal));
  const bulletVal = value.props.bulletText as PyVal | undefined;
  return {
    type: "text",
    inline,
    style,
    bullet: bullet ?? (bulletVal && bulletVal.t !== "none" && bulletVal.t !== "unknown" ? parseBullet(toText(bulletVal)) : undefined),
    typing: Boolean(value.props.typing),
    mono: isPre,
  };
}

function parseBullet(text: string): string {
  return inlineText(parseInlineMarkup(text)) || "•";
}

function cellOf(value: PyVal, ctx: ConvertContext): DraftTableCell {
  if (value.t === "obj" && value.cls === "paragraph") {
    const block = paragraphBlock(value, ctx);
    return block.type === "text" ? { inline: block.inline, bold: block.style.bold, align: block.style.align === "justify" ? "left" : block.style.align, color: block.style.color } : { inline: [] };
  }
  if (value.t === "obj") {
    // Nested flowables in a cell: show their text
    const nested: DraftBlock[] = [];
    convertFlowable(value, { ...ctx, out: nested });
    return { inline: plainInline(nested.map((b) => (b.type === "text" ? inlineText(b.inline) : "")).filter(Boolean).join(" ")) };
  }
  if (value.t === "list") return { inline: plainInline(value.items.map((v) => toText(v)).join(" ")) };
  if (value.t === "none" || value.t === "unknown") return { inline: [] };
  return { inline: plainInline(toText(value)) };
}

/** Header colors, grid and zebra stripes from TableStyle commands. */
function tableLook(cmds: PyVal[]): Partial<Extract<DraftBlock, { type: "table" }>> & { headerBold?: boolean } {
  const look: Partial<Extract<DraftBlock, { type: "table" }>> & { headerBold?: boolean } = {};
  for (const cmd of cmds) {
    const parts = iterItems(cmd);
    if (!parts || parts.length < 3) continue;
    const op = toText(parts[0]).toUpperCase();
    const startRow = iterItems(parts[1])?.[1];
    const isHeader = startRow?.t === "num" && startRow.v === 0;
    const endRow = iterItems(parts[2])?.[1];
    const headerOnly = isHeader && endRow?.t === "num" && endRow.v === 0;
    if (op === "BACKGROUND" && headerOnly) look.headerBackground = colorOf(parts[3]);
    else if (op === "TEXTCOLOR" && headerOnly) look.headerColor = colorOf(parts[3]);
    else if ((op === "GRID" || op === "INNERGRID" || op === "BOX" || op === "LINEBELOW") && !look.gridColor) look.gridColor = colorOf(parts[4]);
    else if (op === "ROWBACKGROUNDS") {
      const colors = iterItems(parts[3]);
      look.zebra = colors ? colorOf(colors[1] ?? colors[0]) : undefined;
    } else if (op === "FONTNAME" && headerOnly && /bold/i.test(toText(parts[3]))) look.headerBold = true;
    else if (op === "FONTSIZE") look.fontSize = toNumber(parts[3], 9);
  }
  return look;
}

function convertFlowable(value: PyVal, ctx: ConvertContext, bullet?: string): void {
  if (ctx.out.length >= DRAFT_LIMITS.blocks) return;
  if (value.t === "list") {
    for (const item of value.items) convertFlowable(item, ctx);
    return;
  }
  if (value.t !== "obj") return;
  switch (value.cls) {
    case "paragraph":
    case "preformatted":
      ctx.out.push(paragraphBlock(value, ctx, bullet));
      return;
    case "spacer":
      ctx.out.push({ type: "spacer", height: Math.max(0, Math.min(800, toNumber(value.props.height as PyVal, 6))) });
      return;
    case "pagebreak":
      ctx.out.push({ type: "pagebreak" });
      return;
    case "hr":
      ctx.out.push({
        type: "rule",
        thickness: Math.max(0.25, Math.min(20, Number(value.props.thickness) || 1)),
        color: value.props.color as string | undefined,
        spaceBefore: Number(value.props.spaceBefore) || 0,
        spaceAfter: Number(value.props.spaceAfter) || 0,
        widthPercent: Number(value.props.widthPercent) || 100,
      });
      return;
    case "image":
      ctx.out.push({
        type: "image",
        label: String(value.props.label ?? "image"),
        width: value.props.width as number | undefined,
        height: value.props.height as number | undefined,
      });
      return;
    case "keep":
      convertFlowable((value.props.items as PyVal) ?? { t: "unknown" }, ctx);
      return;
    case "listitem":
      convertFlowable((value.props.item as PyVal) ?? { t: "unknown" }, ctx, bullet);
      return;
    case "list": {
      const items = iterItems((value.props.items as PyVal) ?? { t: "unknown" }) ?? [];
      const type = toText(value.props.bulletType as PyVal | undefined) || "bullet";
      let counter = toNumber(value.props.start as PyVal | undefined, 1);
      for (const item of items) {
        const mark = type === "1" ? `${counter}.` : type === "a" ? `${String.fromCharCode(96 + ((counter - 1) % 26) + 1)}.` : type === "i" ? `${counter}.` : "•";
        counter += 1;
        if (isObj(item) || item.t === "list") convertFlowable(item, ctx, mark);
        else if (item.t === "str") ctx.out.push({ type: "text", inline: plainInline(item.v), style: resolveTextStyle(undefined, ctx.registry), bullet: mark, typing: !item.complete });
      }
      return;
    }
    case "table": {
      const rows = iterItems((value.props.data as PyVal) ?? { t: "unknown" }) ?? [];
      const look = tableLook(value.props.cmds as PyVal[]);
      const cells = rows.slice(0, DRAFT_LIMITS.tableRows).map((row) => (iterItems(row) ?? [row]).map((cell) => cellOf(cell, ctx)));
      if (look.headerBold && cells[0]) cells[0] = cells[0].map((c) => ({ ...c, bold: true }));
      const widths = iterItems((value.props.colWidths as PyVal) ?? { t: "unknown" })?.map((w) => toNumber(w, 0));
      const firstParagraph = rows.flatMap((r) => iterItems(r) ?? []).find((c) => isObj(c, "paragraph")) as (PyVal & { t: "obj" }) | undefined;
      const style = resolveTextStyle(firstParagraph ? (firstParagraph.props.style as PyVal) : undefined, ctx.registry);
      ctx.out.push({
        type: "table",
        rows: cells,
        colWidths: widths && widths.every((w) => w > 0) ? widths : undefined,
        headerBackground: look.headerBackground,
        headerColor: look.headerColor,
        gridColor: look.gridColor,
        zebra: look.zebra,
        fontSize: look.fontSize ?? style.fontSize,
        fontKind: style.fontKind,
        fontName: style.fontName,
        typing: rows.some((r) => (iterItems(r) ?? []).some(isIncomplete)),
      });
      return;
    }
    default:
      return;
  }
}

export function flowablesToBlocks(items: PyVal[], registry: FontRegistry): DraftBlock[] {
  const out: DraftBlock[] = [];
  for (const item of items) convertFlowable(item, { registry, out });
  return out;
}

/** Number of top-level flowables in a list (to pick the story). */
export function flowableCount(value: PyVal & { t: "list" }): number {
  let count = 0;
  for (const item of value.items) if (isFlowable(item)) count += 1;
  return count;
}

export { styleProp };
