import { fontKindOf, plainInline } from "../common";
import { DEFAULT_TEXT_STYLE, DRAFT_LIMITS, type DraftPageSize, type FixedItem } from "../types";
import { flowablesToBlocks } from "./rl-flowables";
import { colorOf, fontInfo, type FontRegistry } from "./rl-styles";
import { NONE, isIncomplete, iterItems, obj, toNumber, toText, truthy, type PyVal } from "./values";

export interface CanvasPage {
  items: FixedItem[];
  page: DraftPageSize;
}

interface CanvasState {
  page: DraftPageSize;
  pages: CanvasPage[];
  items: FixedItem[];
  fontName: string;
  fontSize: number;
  fill: string;
  stroke: string;
  lineWidth: number;
}

function sizeOf(value: PyVal | undefined, fallback: [number, number]): [number, number] {
  const items = value ? iterItems(value) : null;
  if (items && items.length >= 2) {
    const w = toNumber(items[0], fallback[0]);
    const h = toNumber(items[1], fallback[1]);
    if (w > 10 && h > 10 && w < 20000 && h < 20000) return [w, h];
  }
  return fallback;
}

export function pageOf(size: [number, number], margins?: Partial<DraftPageSize["margins"]>): DraftPageSize {
  return {
    width: size[0],
    height: size[1],
    margins: { top: margins?.top ?? 72, right: margins?.right ?? 72, bottom: margins?.bottom ?? 72, left: margins?.left ?? 72 },
  };
}

export function makeCanvas(args: PyVal[], kw: Map<string, PyVal>, a4: [number, number]): PyVal & { t: "obj" } {
  const state: CanvasState = {
    page: pageOf(sizeOf(kw.get("pagesize") ?? args[1], a4), { top: 0, right: 0, bottom: 0, left: 0 }),
    pages: [],
    items: [],
    fontName: "Helvetica",
    fontSize: 12,
    fill: "#000000",
    stroke: "#000000",
    lineWidth: 1,
  };
  return obj("canvas", { state });
}

export function canvasPages(canvas: PyVal & { t: "obj" }): CanvasPage[] {
  const state = canvas.props.state as CanvasState;
  return state.items.length > 0 ? [...state.pages, { items: state.items, page: state.page }] : state.pages;
}

function push(state: CanvasState, item: FixedItem): void {
  const total = state.pages.reduce((n, p) => n + p.items.length, 0) + state.items.length;
  if (total < DRAFT_LIMITS.fixedItems) state.items.push(item);
}

function flag(args: PyVal[], kw: Map<string, PyVal>, index: number, key: string, fallback: boolean): boolean {
  const value = kw.get(key) ?? args[index];
  return value ? truthy(value) : fallback;
}

function textItem(state: CanvasState, registry: FontRegistry, x: number, y: number, text: PyVal, anchor: "start" | "middle" | "end"): FixedItem {
  const font = fontInfo(state.fontName, registry);
  const size = state.fontSize;
  return {
    type: "text",
    x,
    y: state.page.height - y - size * 0.8,
    anchor,
    inline: plainInline(toText(text)),
    style: {
      ...DEFAULT_TEXT_STYLE,
      fontName: font.family,
      fontKind: fontKindOf(font.family ?? state.fontName),
      fontSize: size,
      leading: size * 1.2,
      bold: font.bold,
      italic: font.italic,
      color: state.fill,
    },
    typing: isIncomplete(text),
  };
}

/** Methods of a reportlab `canvas.Canvas`; null when not a canvas method we model. */
export function canvasMethod(
  canvas: PyVal & { t: "obj" },
  name: string,
  args: PyVal[],
  kw: Map<string, PyVal>,
  registry: FontRegistry
): PyVal | null {
  const state = canvas.props.state as CanvasState;
  const n = (i: number, key?: string, fallback = 0) => toNumber((key ? kw.get(key) : undefined) ?? args[i], fallback);
  const H = state.page.height;
  switch (name) {
    case "setFont":
      state.fontName = toText(args[0]) || state.fontName;
      state.fontSize = Math.max(1, Math.min(400, n(1, "size", state.fontSize)));
      return NONE;
    case "setFontSize":
      state.fontSize = Math.max(1, Math.min(400, n(0, "size", state.fontSize)));
      return NONE;
    case "setFillColor":
    case "setFillColorRGB":
    case "setFillColorCMYK":
    case "setStrokeColor":
    case "setStrokeColorRGB":
    case "setStrokeColorCMYK": {
      const color = name.endsWith("RGB")
        ? colorOf({ t: "list", items: args.slice(0, 3) })
        : name.endsWith("CMYK")
          ? undefined
          : colorOf(args[0]);
      if (color) {
        if (name.startsWith("setFill")) state.fill = color;
        else state.stroke = color;
      }
      return NONE;
    }
    case "setLineWidth":
      state.lineWidth = Math.max(0, Math.min(50, n(0)));
      return NONE;
    case "drawString":
    case "drawCentredString":
    case "drawCenteredString":
    case "drawRightString":
      push(state, textItem(state, registry, n(0, "x"), n(1, "y"), kw.get("text") ?? args[2] ?? { t: "unknown" }, name === "drawString" ? "start" : name === "drawRightString" ? "end" : "middle"));
      return NONE;
    case "rect":
    case "roundRect": {
      const [x, y, w, h] = [n(0, "x"), n(1, "y"), n(2, "width"), n(3, "height")];
      const radius = name === "roundRect" ? n(4, "radius") : 0;
      const offset = name === "roundRect" ? 1 : 0;
      const fill = flag(args, kw, 5 + offset, "fill", false);
      const stroke = flag(args, kw, 4 + offset, "stroke", true);
      push(state, {
        type: "shape",
        shape: "rect",
        x: Math.min(x, x + w),
        y: H - Math.max(y, y + h),
        w: Math.abs(w),
        h: Math.abs(h),
        radius,
        fill: fill ? state.fill : undefined,
        stroke: stroke ? state.stroke : undefined,
        strokeWidth: state.lineWidth,
      });
      return NONE;
    }
    case "circle": {
      const [cx, cy, r] = [n(0, "x_cen"), n(1, "y_cen"), n(2, "r")];
      push(state, {
        type: "shape",
        shape: "ellipse",
        x: cx - r,
        y: H - cy - r,
        w: r * 2,
        h: r * 2,
        fill: flag(args, kw, 4, "fill", false) ? state.fill : undefined,
        stroke: flag(args, kw, 3, "stroke", true) ? state.stroke : undefined,
        strokeWidth: state.lineWidth,
      });
      return NONE;
    }
    case "ellipse": {
      const [x1, y1, x2, y2] = [n(0), n(1), n(2), n(3)];
      push(state, {
        type: "shape",
        shape: "ellipse",
        x: Math.min(x1, x2),
        y: H - Math.max(y1, y2),
        w: Math.abs(x2 - x1),
        h: Math.abs(y2 - y1),
        fill: flag(args, kw, 5, "fill", false) ? state.fill : undefined,
        stroke: flag(args, kw, 4, "stroke", true) ? state.stroke : undefined,
        strokeWidth: state.lineWidth,
      });
      return NONE;
    }
    case "line": {
      const [x1, y1, x2, y2] = [n(0), n(1), n(2), n(3)];
      push(state, { type: "shape", shape: "line", x: x1, y: H - y1, w: x2 - x1, h: y1 - y2, stroke: state.stroke, strokeWidth: state.lineWidth });
      return NONE;
    }
    case "drawImage":
    case "drawInlineImage": {
      const source = args[0];
      const w = n(3, "width", 100);
      const h = n(4, "height", 100);
      push(state, {
        type: "image",
        x: n(1, "x"),
        y: H - n(2, "y") - h,
        w,
        h,
        label: source?.t === "str" ? source.v.split(/[\\/]/).pop() ?? "image" : "image",
      });
      return NONE;
    }
    case "setPageSize": {
      const size = sizeOf(args[0], [state.page.width, state.page.height]);
      state.page = pageOf(size, { top: 0, right: 0, bottom: 0, left: 0 });
      return NONE;
    }
    case "showPage":
      state.pages.push({ items: state.items, page: state.page });
      state.items = [];
      // A new page starts from reportlab's default graphics state
      state.fontName = "Helvetica";
      state.fontSize = 12;
      state.fill = "#000000";
      state.stroke = "#000000";
      state.lineWidth = 1;
      return NONE;
    case "save":
    case "saveState":
    case "restoreState":
    case "translate":
    case "rotate":
    case "scale":
    case "setTitle":
    case "setAuthor":
    case "setSubject":
    case "setDash":
    case "setLineCap":
    case "setLineJoin":
    case "setFillAlpha":
    case "setStrokeAlpha":
    case "bookmarkPage":
    case "addOutlineEntry":
    case "linkURL":
      return NONE;
    default:
      return null;
  }
}

/** `Frame(x, y, w, h).addFromList(story, canvas)`: the story flows inside the frame box. */
export function addFlowToCanvas(
  canvas: PyVal & { t: "obj" },
  box: { x: number; y: number; w: number; h?: number; anchorBottom?: boolean },
  items: PyVal[],
  registry: FontRegistry
): void {
  const state = canvas.props.state as CanvasState;
  const blocks = flowablesToBlocks(items, registry);
  if (blocks.length === 0) return;
  const H = state.page.height;
  push(state, {
    type: "flow",
    x: box.x,
    y: box.anchorBottom ? H - box.y : H - box.y - (box.h ?? 0),
    w: Math.max(20, box.w),
    h: box.h,
    anchorBottom: box.anchorBottom,
    blocks,
  });
}
