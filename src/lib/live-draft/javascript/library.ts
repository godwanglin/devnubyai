import type { DraftSection } from "../types";
import { DOCX_CLASSES, docxBlocks, docxPage, readDocxDefaults } from "./docx";
import type { JsLibrary } from "./interpreter";
import {
  addImage,
  addShape,
  addTable,
  addText,
  defineLayout,
  newPresentation,
  setBackground,
  setLayout,
  slidePage,
  type PptxState,
  type SlideState,
} from "./pptx";
import { NIL, prop, type JsVal } from "./values";

const MAX_TRACKED = 6000;
const PPTX_CLASS = /^(?:pptxgen(?:js)?|PptxGenJS|pptxgenjs\.default)$/i;

function last(path: string): string {
  return path.slice(path.lastIndexOf(".") + 1);
}

function docxCount(value: JsVal & { t: "arr" }): number {
  let count = 0;
  for (const item of value.items) if (item.t === "inst" && (item.cls === "Paragraph" || item.cls === "Table")) count += 1;
  return count;
}

/** `docx` and pptxgenjs as seen by the JS draft interpreter. */
export class DraftJsLibrary implements JsLibrary {
  private readonly arrays: (JsVal & { t: "arr" })[] = [];
  private readonly documents: (JsVal & { t: "inst" })[] = [];
  private readonly presentations: PptxState[] = [];

  resolveRef(path: string): JsVal | null {
    // `pres.shapes.RECTANGLE`, `ShapeType.rect`: the last segment names the shape
    if (/(?:^|\.)(?:shapes|ShapeType)\.\w+$/.test(path)) return { t: "str", v: last(path), complete: true };
    return null;
  }

  construct(path: string, args: JsVal[]): JsVal | null {
    const name = last(path);
    if (PPTX_CLASS.test(path) || PPTX_CLASS.test(name)) {
      const state = newPresentation();
      this.presentations.push(state);
      return { t: "inst", cls: "pptx", args, state: { pptx: state } };
    }
    if (DOCX_CLASSES.has(name)) {
      const typing = args.some((a) => a.t === "str" && !a.complete) || hasTypingText(args[0]);
      const inst: JsVal & { t: "inst" } = { t: "inst", cls: name, args, state: { typing } };
      if (name === "Document") this.documents.push(inst);
      return inst;
    }
    return null;
  }

  callRef(path: string): JsVal | null {
    if (/(?:^|\.)Packer\.\w+$/.test(path)) return { t: "unknown" };
    return null;
  }

  callMethod(target: JsVal & { t: "inst" }, name: string, args: JsVal[]): JsVal | null {
    if (target.cls === "pptx") {
      const pptx = target.state.pptx as PptxState;
      if (name === "addSlide") {
        const slide: SlideState = { items: [] };
        pptx.slides.push(slide);
        return { t: "inst", cls: "slide", args, state: { slide, pptx } };
      }
      if (name === "defineLayout") {
        defineLayout(pptx, args[0]);
        return NIL;
      }
      if (name === "writeFile" || name === "write" || name === "stream" || name === "defineSlideMaster") return { t: "unknown" };
      return null;
    }
    if (target.cls === "slide") {
      const slide = target.state.slide as SlideState;
      const pptx = target.state.pptx as PptxState;
      switch (name) {
        case "addText":
          addText(pptx, slide, args[0], args[1]);
          return target;
        case "addShape":
          addShape(pptx, slide, args[0], args[1]);
          return target;
        case "addImage":
          addImage(pptx, slide, args[0]);
          return target;
        case "addChart":
          addImage(pptx, slide, args[2], "chart");
          return target;
        case "addTable":
          addTable(pptx, slide, args[0], args[1]);
          return target;
        case "addNotes":
          return target;
        default:
          return null;
      }
    }
    return null;
  }

  getProp(target: JsVal & { t: "inst" }, name: string): JsVal | null {
    if (target.cls === "pptx" && (name === "shapes" || name === "ShapeType" || name === "ChartType")) return { t: "ref", path: name };
    return null;
  }

  setProp(target: JsVal & { t: "inst" }, name: string, value: JsVal): void {
    if (target.cls === "pptx" && name === "layout") setLayout(target.state.pptx as PptxState, value);
    if (target.cls === "slide" && (name === "background" || name === "bkgd")) setBackground(target.state.slide as SlideState, value);
  }

  onArray(value: JsVal & { t: "arr" }): void {
    if (this.arrays.length < MAX_TRACKED) this.arrays.push(value);
  }

  buildSections(): DraftSection[] {
    const sections: DraftSection[] = [];
    for (const doc of this.documents) {
      const opts = doc.args[0];
      const defaults = readDocxDefaults(opts);
      const docSections = prop(opts, "sections");
      if (docSections?.t !== "arr") continue;
      for (const section of docSections.items) {
        const children = prop(section, "children");
        sections.push({ kind: "flow", page: docxPage(section), blocks: docxBlocks(children?.t === "arr" ? children.items : [], defaults) });
      }
    }
    // The Document is created last: until then, the biggest list of paragraphs is the body
    if (this.documents.length === 0) {
      let best: (JsVal & { t: "arr" }) | null = null;
      for (const candidate of this.arrays) if (!best || docxCount(candidate) > docxCount(best)) best = candidate;
      if (best && docxCount(best) > 0) sections.push({ kind: "flow", page: docxPage(undefined), blocks: docxBlocks(best.items, readDocxDefaults(undefined)) });
    }
    for (const pptx of this.presentations) {
      for (const slide of pptx.slides) sections.push({ kind: "fixed", page: slidePage(pptx), background: slide.background ?? "#ffffff", items: slide.items });
    }
    return sections;
  }
}

function hasTypingText(opts: JsVal | undefined): boolean {
  const text = prop(opts, "text");
  if (text?.t === "str" && !text.complete) return true;
  const children = prop(opts, "children");
  return children?.t === "arr" && children.items.some((c) => (c.t === "str" && !c.complete) || (c.t === "inst" && Boolean(c.state.typing)));
}
