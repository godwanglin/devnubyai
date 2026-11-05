import { fontFamilyOf, fontFlagsOf, normalizeColor } from "../common";
import { A4, type DraftSection } from "../types";
import type { PyLibrary } from "./interpreter";
import {
  cellSetAttr,
  dimSetAttr,
  dimsItem,
  makeWorkbook,
  makeXlFont,
  sheetAttr,
  sheetItem,
  sheetMethod,
  sheetSetAttr,
  sheetSetItem,
  workbookAttr,
  workbookItem,
  workbookMethod,
  workbookSheets,
} from "./openpyxl";
import { addFlowToCanvas, canvasMethod, canvasPages, makeCanvas, pageOf } from "./rl-canvas";
import { flowableCount, flowablesToBlocks, isFlowable, makeFlowable, tableStyleCommands } from "./rl-flowables";
import {
  ALIGN_REFS,
  PAGE_SIZES,
  UNIT_REFS,
  colorObj,
  makeColor,
  makeParagraphStyle,
  sampleStyleSheet,
  type FontRegistry,
} from "./rl-styles";
import { NONE, iterItems, list, num, obj, str, toNumber, toText, type PyVal } from "./values";

const MAX_TRACKED_LISTS = 6000;

function lastSegment(path: string): string {
  const parts = path.split(".");
  return parts[parts.length - 1];
}

function sizeFrom(value: PyVal | undefined): [number, number] | null {
  const items = value ? iterItems(value) : null;
  if (!items || items.length < 2) return null;
  const w = toNumber(items[0], NaN);
  const h = toNumber(items[1], NaN);
  return Number.isFinite(w) && Number.isFinite(h) && w > 10 && h > 10 ? [w, h] : null;
}

/** reportlab (platypus + canvas) and openpyxl as seen by the draft interpreter. */
export class DraftPythonLibrary implements PyLibrary {
  readonly fonts: FontRegistry = new Map();
  private readonly lists: (PyVal & { t: "list" })[] = [];
  /** Documents, canvases and workbooks in the order the code created them */
  private readonly targets: (PyVal & { t: "obj" })[] = [];

  resolveRef(path: string): PyVal | null {
    const name = lastSegment(path);
    if (name in UNIT_REFS) return num(UNIT_REFS[name]);
    if (name in PAGE_SIZES) return list(PAGE_SIZES[name].map((v) => num(v)), true);
    if (name in ALIGN_REFS) return num(["left", "center", "right", "", "justify"].indexOf(ALIGN_REFS[name]));
    if (path.startsWith("colors.") || path.startsWith("reportlab.lib.colors.")) {
      const css = normalizeColor(name);
      if (css) return colorObj(css);
    }
    return null;
  }

  callRef(path: string, args: PyVal[], kw: Map<string, PyVal>): PyVal | null {
    const name = lastSegment(path);
    const color = makeColor(name, args);
    if (color) return color;
    const flowable = makeFlowable(name, args, kw);
    if (flowable) return flowable;
    switch (name) {
      case "ParagraphStyle":
        return makeParagraphStyle(args, kw);
      case "getSampleStyleSheet":
        return sampleStyleSheet();
      case "landscape":
      case "portrait": {
        const size = sizeFrom(args[0]) ?? A4;
        const [w, h] = size;
        const swap = name === "landscape" ? w < h : w > h;
        return list((swap ? [h, w] : [w, h]).map((v) => num(v)), true);
      }
      case "TTFont": {
        const fontName = toText(args[0]);
        const file = toText(args[1]);
        if (fontName) {
          const flags = fontFlagsOf(file);
          this.fonts.set(fontName, { family: fontFamilyOf(file) ?? fontName, bold: flags.bold, italic: flags.italic });
        }
        return obj("ttfont", { name: fontName });
      }
      case "registerFont":
      case "registerFontFamily":
      case "setFont":
        return NONE;
      case "SimpleDocTemplate":
      case "BaseDocTemplate":
      case "DocTemplate": {
        const size = sizeFrom(kw.get("pagesize")) ?? A4;
        const m = (key: string) => toNumber(kw.get(key), 72);
        const doc = obj("doc", { page: pageOf(size, { top: m("topMargin"), right: m("rightMargin"), bottom: m("bottomMargin"), left: m("leftMargin") }) });
        this.targets.push(doc);
        return doc;
      }
      case "Canvas": {
        const canvas = makeCanvas(args, kw, A4);
        this.targets.push(canvas);
        return canvas;
      }
      case "Frame":
        return obj("frame", { x: toNumber(args[0]), y: toNumber(args[1]), w: toNumber(args[2]), h: toNumber(args[3]) });
      case "Workbook": {
        const wb = makeWorkbook();
        this.targets.push(wb);
        return wb;
      }
      case "Font":
        return makeXlFont(kw);
      case "PatternFill":
      case "Alignment":
      case "Border":
      case "Side":
        return obj("xlstyle");
      case "stringWidth":
        return num(toText(args[0]).length * toNumber(args[2], 10) * 0.5);
      default:
        return null;
    }
  }

  callMethod(target: PyVal & { t: "obj" }, name: string, args: PyVal[], kw: Map<string, PyVal>): PyVal | null {
    switch (target.cls) {
      case "canvas":
        return canvasMethod(target, name, args, kw, this.fonts);
      case "doc":
        if (name === "build" || name === "multiBuild") {
          if (args[0]?.t === "list") target.props.story = args[0];
          return NONE;
        }
        return null;
      case "stylesheet":
        if (name === "add" && args[0]?.t === "obj") {
          const styles = target.props.styles as Map<string, PyVal>;
          styles.set(toText(args[0].props.name as PyVal), args[0]);
          return NONE;
        }
        if (name === "get") return (target.props.styles as Map<string, PyVal>).get(toText(args[0])) ?? NONE;
        return null;
      case "tablestyle":
        if (name === "add") {
          const cmds = target.props.cmds as PyVal;
          if (cmds?.t === "list") cmds.items.push(list(args, true));
          return NONE;
        }
        return null;
      case "frame":
        if (name === "addFromList" && args[1]?.t === "obj" && args[1].cls === "canvas") {
          const items = iterItems(args[0] ?? NONE) ?? [];
          const p = target.props as { x: number; y: number; w: number; h: number };
          addFlowToCanvas(args[1], { x: p.x, y: p.y, w: p.w, h: p.h }, items, this.fonts);
          if (args[0]?.t === "list") args[0].items.length = 0;
          return NONE;
        }
        return null;
      case "paragraph":
      case "table":
      case "image":
        if (name === "setStyle" && target.cls === "table") {
          (target.props.cmds as PyVal[]).push(...tableStyleCommands(args[0]));
          return NONE;
        }
        if (name === "wrap" || name === "wrapOn") {
          target.props.wrapWidth = toNumber(args[name === "wrapOn" ? 1 : 0], 400);
          return list([num(target.props.wrapWidth as number), num(40)], true);
        }
        if (name === "drawOn" && args[0]?.t === "obj" && args[0].cls === "canvas") {
          addFlowToCanvas(args[0], { x: toNumber(args[1]), y: toNumber(args[2]), w: Number(target.props.wrapWidth) || 400, anchorBottom: true }, [target], this.fonts);
          return NONE;
        }
        return null;
      case "workbook":
        return workbookMethod(target, name, args, kw);
      case "sheet":
        return sheetMethod(target, name, args, kw);
      default:
        return null;
    }
  }

  getAttr(target: PyVal & { t: "obj" }, name: string): PyVal | null {
    switch (target.cls) {
      case "stylesheet":
        return (target.props.styles as Map<string, PyVal>).get(name) ?? null;
      case "style":
        return (target.props[name] as PyVal | undefined) ?? null;
      case "doc": {
        const page = target.props.page as ReturnType<typeof pageOf>;
        if (name === "width") return num(page.width - page.margins.left - page.margins.right);
        if (name === "height") return num(page.height - page.margins.top - page.margins.bottom);
        if (name === "leftMargin") return num(page.margins.left);
        if (name === "rightMargin") return num(page.margins.right);
        if (name === "topMargin") return num(page.margins.top);
        if (name === "bottomMargin") return num(page.margins.bottom);
        if (name === "pagesize") return list([num(page.width), num(page.height)], true);
        return null;
      }
      case "workbook":
        return workbookAttr(target, name);
      case "sheet":
        return sheetAttr(target, name);
      default:
        return null;
    }
  }

  setAttr(target: PyVal & { t: "obj" }, name: string, value: PyVal): void {
    if (target.cls === "style") target.props[name] = value;
    else if (target.cls === "sheet") sheetSetAttr(target, name, value);
    else if (target.cls === "cell") cellSetAttr(target, name, value);
    else if (target.cls === "dim") dimSetAttr(target, name, value);
    else if (target.cls === "workbook" && name === "active" && value.t === "obj") target.props.active = value;
  }

  getItem(target: PyVal & { t: "obj" }, key: PyVal): PyVal | null {
    switch (target.cls) {
      case "stylesheet":
        return (target.props.styles as Map<string, PyVal>).get(toText(key)) ?? null;
      case "workbook":
        return workbookItem(target, key);
      case "sheet":
        return sheetItem(target, key);
      case "dims":
        return dimsItem(target, key);
      default:
        return null;
    }
  }

  setItem(target: PyVal & { t: "obj" }, key: PyVal, value: PyVal): void {
    if (target.cls === "sheet") sheetSetItem(target, key, value);
  }

  onList(value: PyVal & { t: "list" }): void {
    if (this.lists.length < MAX_TRACKED_LISTS) this.lists.push(value);
  }

  /** The story of a document: what it was built with, else the biggest list of flowables. */
  private storyFor(doc: PyVal & { t: "obj" }, claimed: Set<PyVal>): PyVal[] {
    const built = doc.props.story as (PyVal & { t: "list" }) | undefined;
    if (built) {
      claimed.add(built);
      return built.items;
    }
    let best: (PyVal & { t: "list" }) | null = null;
    let bestCount = 0;
    for (const candidate of this.lists) {
      if (claimed.has(candidate)) continue;
      const count = flowableCount(candidate);
      if (count > bestCount) {
        best = candidate;
        bestCount = count;
      }
    }
    if (!best) return [];
    claimed.add(best);
    return best.items;
  }

  buildSections(): DraftSection[] {
    const sections: DraftSection[] = [];
    const claimed = new Set<PyVal>();
    for (const target of this.targets) {
      const built = target.props.story as PyVal | undefined;
      if (built) claimed.add(built);
    }
    for (const target of this.targets) {
      if (target.cls === "doc") {
        const blocks = flowablesToBlocks(this.storyFor(target, claimed), this.fonts);
        sections.push({ kind: "flow", page: target.props.page as ReturnType<typeof pageOf>, blocks });
      } else if (target.cls === "canvas") {
        for (const page of canvasPages(target)) sections.push({ kind: "fixed", page: page.page, items: page.items });
      } else if (target.cls === "workbook") {
        const sheets = workbookSheets(target).filter((s) => s.cells.length > 0);
        if (sheets.length > 0) sections.push({ kind: "sheets", sheets });
      }
    }
    // Story written before its SimpleDocTemplate (or without one yet)
    if (!this.targets.some((t) => t.cls === "doc")) {
      const story = this.storyFor(obj("doc", {}), claimed);
      if (story.some(isFlowable)) {
        sections.unshift({ kind: "flow", page: pageOf(A4), blocks: flowablesToBlocks(story, this.fonts) });
      }
    }
    return sections;
  }
}

export { str };
