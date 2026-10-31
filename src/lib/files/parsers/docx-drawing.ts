import { child, childElements, path, type XmlElement } from "./xml";
import { drawingColorChild, resolveDrawingColor, resolveDrawingFill, type DrawingColorScheme } from "./drawingml";

/**
 * Model of a WordprocessingML drawing (`wp:anchor` / `wp:inline`): position and wrapping
 * on the page plus the DrawingML tree inside it — groups, shapes with preset or custom
 * geometry, pictures and text boxes. Geometry is in CSS px (1px = 9525 EMU), relative to
 * the parent group's box.
 */

export const EMU_PER_PX = 9525;
const px = (emu: string | undefined) => (Number(emu) || 0) / EMU_PER_PX;

export interface DrawingBox {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export interface DrawingPath {
  w: number;
  h: number;
  d: string;
}

export type DrawingGeometry =
  | { type: "rect" }
  | { type: "roundRect"; radius: number }
  | { type: "ellipse" }
  | { type: "line" }
  | { type: "path"; paths: DrawingPath[] };

export interface DrawingLine {
  color: string;
  width: number;
}

export type DrawingNode =
  | { kind: "group"; box: DrawingBox; children: DrawingNode[] }
  | {
      kind: "shape";
      box: DrawingBox;
      geometry: DrawingGeometry;
      fill: string | null;
      line: DrawingLine | null;
      /** Index into the document's text-box list, rendered separately. */
      textBox: number | null;
      insets: [number, number, number, number];
      verticalAnchor: "top" | "middle" | "bottom";
    }
  | {
      kind: "picture";
      box: DrawingBox;
      mediaPath: string | null;
      /** Crop fractions [left, top, right, bottom]. */
      crop: [number, number, number, number];
      opacity: number;
    };

export interface DrawingPosition {
  relativeFrom: string;
  align: string | null;
  offset: number;
}

export type DrawingWrap = "inline" | "none" | "topAndBottom" | "square" | "tight" | "through";

export interface DocxDrawing {
  inline: boolean;
  width: number;
  height: number;
  wrap: DrawingWrap;
  behindDoc: boolean;
  zIndex: number;
  /** Distance kept from surrounding text: [top, right, bottom, left]. */
  distance: [number, number, number, number];
  horizontal: DrawingPosition;
  vertical: DrawingPosition;
  root: DrawingNode;
}

export interface DrawingContext {
  scheme: DrawingColorScheme;
  /** Relationship id → zip path of the part that holds the drawing. */
  rels: Map<string, string>;
  /** Text-box contents in document order; shapes reference them by index. */
  textBoxes: XmlElement[];
}

function parseBox(xfrm: XmlElement | undefined): DrawingBox {
  const off = child(xfrm, "a:off");
  const ext = child(xfrm, "a:ext");
  return {
    x: px(off?.attrs.x),
    y: px(off?.attrs.y),
    w: px(ext?.attrs.cx),
    h: px(ext?.attrs.cy),
    rotation: (Number(xfrm?.attrs.rot) || 0) / 60000,
    flipH: xfrm?.attrs.flipH === "1",
    flipV: xfrm?.attrs.flipV === "1",
  };
}

function pathData(pathEl: XmlElement): string {
  const pt = (el: XmlElement | undefined) => `${Number(el?.attrs.x) || 0} ${Number(el?.attrs.y) || 0}`;
  const parts: string[] = [];
  for (const cmd of childElements(pathEl)) {
    const pts = childElements(cmd, "a:pt");
    switch (cmd.name) {
      case "a:moveTo":
        parts.push(`M ${pt(pts[0])}`);
        break;
      case "a:lnTo":
        parts.push(`L ${pt(pts[0])}`);
        break;
      case "a:cubicBezTo":
        parts.push(`C ${pts.map(pt).join(" ")}`);
        break;
      case "a:quadBezTo":
        parts.push(`Q ${pts.map(pt).join(" ")}`);
        break;
      case "a:close":
        parts.push("Z");
        break;
    }
  }
  return parts.join(" ");
}

function parseGeometry(spPr: XmlElement | undefined, box: DrawingBox): DrawingGeometry {
  const cust = child(spPr, "a:custGeom");
  if (cust) {
    const paths = childElements(child(cust, "a:pathLst"), "a:path").map((p) => ({
      w: Number(p.attrs.w) || box.w * EMU_PER_PX || 1,
      h: Number(p.attrs.h) || box.h * EMU_PER_PX || 1,
      d: pathData(p),
    }));
    if (paths.length) return { type: "path", paths };
  }
  const prst = child(spPr, "a:prstGeom")?.attrs.prst ?? "rect";
  switch (prst) {
    case "ellipse":
      return { type: "ellipse" };
    case "roundRect": {
      const adj = childElements(path(spPr, "a:prstGeom", "a:avLst"), "a:gd")[0]?.attrs.fmla;
      const ratio = adj ? Number(adj.replace(/^val\s+/, "")) / 100000 : 0.16667;
      return { type: "roundRect", radius: Math.min(box.w, box.h) * ratio };
    }
    case "line":
    case "straightConnector1":
      return { type: "line" };
    default:
      return { type: "rect" };
  }
}

/** Shape outline: explicit `a:ln`, else the shape style's line reference. */
function parseLine(spPr: XmlElement | undefined, style: XmlElement | undefined, ctx: DrawingContext): DrawingLine | null {
  const ln = child(spPr, "a:ln");
  const width = ln?.attrs.w ? px(ln.attrs.w) : 0.75 * (96 / 72);
  if (ln) {
    if (child(ln, "a:noFill")) return null;
    const color = resolveDrawingFill(ln, ctx.scheme);
    if (color) return { color, width };
  }
  const lnRef = child(style, "a:lnRef");
  if (!ln && lnRef && Number(lnRef.attrs.idx) > 0) {
    const color = resolveDrawingColor(drawingColorChild(lnRef), ctx.scheme);
    if (color) return { color, width };
  }
  return null;
}

/** Shape fill: explicit fill in `spPr`, else the shape style's fill reference. */
function parseFill(spPr: XmlElement | undefined, style: XmlElement | undefined, ctx: DrawingContext): string | null {
  const fill = resolveDrawingFill(spPr, ctx.scheme);
  if (fill !== undefined) return fill;
  const fillRef = child(style, "a:fillRef");
  if (fillRef && Number(fillRef.attrs.idx) > 0) return resolveDrawingColor(drawingColorChild(fillRef), ctx.scheme);
  return null;
}

function parseShape(wsp: XmlElement, ctx: DrawingContext): DrawingNode {
  const spPr = child(wsp, "wps:spPr");
  const style = child(wsp, "wps:style");
  const box = parseBox(child(spPr, "a:xfrm"));
  const bodyPr = child(wsp, "wps:bodyPr");
  const inset = (name: string, fallback: number) =>
    bodyPr?.attrs[name] !== undefined ? px(bodyPr.attrs[name]) : fallback / EMU_PER_PX;
  const content = path(wsp, "wps:txbx", "w:txbxContent");
  let textBox: number | null = null;
  if (content) {
    textBox = ctx.textBoxes.length;
    ctx.textBoxes.push(content);
  }
  const anchor = bodyPr?.attrs.anchor;
  return {
    kind: "shape",
    box,
    geometry: parseGeometry(spPr, box),
    fill: parseFill(spPr, style, ctx),
    line: parseLine(spPr, style, ctx),
    textBox,
    insets: [inset("tIns", 45720), inset("rIns", 91440), inset("bIns", 45720), inset("lIns", 91440)],
    verticalAnchor: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
  };
}

function parsePicture(pic: XmlElement, ctx: DrawingContext): DrawingNode {
  const blipFill = child(pic, "pic:blipFill");
  const blip = child(blipFill, "a:blip");
  const embed = blip?.attrs["r:embed"];
  const src = child(blipFill, "a:srcRect");
  const frac = (v: string | undefined) => (Number(v) || 0) / 100000;
  const alpha = child(blip, "a:alphaModFix")?.attrs.amt;
  return {
    kind: "picture",
    box: parseBox(path(pic, "pic:spPr", "a:xfrm")),
    mediaPath: embed ? ctx.rels.get(embed) ?? null : null,
    crop: [frac(src?.attrs.l), frac(src?.attrs.t), frac(src?.attrs.r), frac(src?.attrs.b)],
    opacity: alpha ? Number(alpha) / 100000 : 1,
  };
}

/**
 * Group children live in the group's child coordinate space (chOff/chExt); map them into
 * the group's own box so every node is relative to its parent's top-left corner.
 */
function parseGroup(grp: XmlElement, propsName: string, ctx: DrawingContext): DrawingNode {
  const xfrm = path(grp, propsName, "a:xfrm");
  const box = parseBox(xfrm);
  const chOff = child(xfrm, "a:chOff");
  const chExt = child(xfrm, "a:chExt");
  const cx = px(chOff?.attrs.x);
  const cy = px(chOff?.attrs.y);
  const sx = chExt && px(chExt.attrs.cx) ? box.w / px(chExt.attrs.cx) : 1;
  const sy = chExt && px(chExt.attrs.cy) ? box.h / px(chExt.attrs.cy) : 1;

  const children: DrawingNode[] = [];
  for (const el of childElements(grp)) {
    const node = parseNode(el, ctx);
    if (!node) continue;
    node.box = {
      ...node.box,
      x: (node.box.x - cx) * sx,
      y: (node.box.y - cy) * sy,
      w: node.box.w * sx,
      h: node.box.h * sy,
    };
    children.push(node);
  }
  return { kind: "group", box, children };
}

function parseNode(el: XmlElement, ctx: DrawingContext): DrawingNode | null {
  switch (el.name) {
    case "wps:wsp":
      return parseShape(el, ctx);
    case "pic:pic":
      return parsePicture(el, ctx);
    case "wpg:grpSp":
      return parseGroup(el, "wpg:grpSpPr", ctx);
    case "wpg:wgp":
      return parseGroup(el, "wpg:grpSpPr", ctx);
    default:
      return null;
  }
}

function parsePosition(el: XmlElement | undefined, fallback: string): DrawingPosition {
  const align = child(el, "wp:align");
  const offset = child(el, "wp:posOffset");
  return {
    relativeFrom: el?.attrs.relativeFrom ?? fallback,
    align: align ? align.children.join("").trim() || null : null,
    offset: offset ? px(offset.children.join("").trim()) : 0,
  };
}

const WRAP_TAGS: Record<string, DrawingWrap> = {
  "wp:wrapNone": "none",
  "wp:wrapTopAndBottom": "topAndBottom",
  "wp:wrapSquare": "square",
  "wp:wrapTight": "tight",
  "wp:wrapThrough": "through",
};

/** The graphic payload shapes this module can draw; pictures alone are left to docx-preview. */
export function drawingPayload(container: XmlElement): XmlElement | undefined {
  const data = path(container, "a:graphic", "a:graphicData");
  return childElements(data).find((el) => el.name === "wps:wsp" || el.name === "wpg:wgp" || el.name === "pic:pic");
}

/** Parses a `wp:anchor` or `wp:inline` element; null when it holds nothing drawable. */
export function parseDocxDrawing(container: XmlElement, ctx: DrawingContext): DocxDrawing | null {
  const payload = drawingPayload(container);
  if (!payload) return null;
  const root = parseNode(payload, ctx);
  if (!root) return null;

  const inline = container.name === "wp:inline";
  const extent = child(container, "wp:extent");
  const width = px(extent?.attrs.cx);
  const height = px(extent?.attrs.cy);
  // the payload's own offset is meaningless at the top level: the anchor positions it
  root.box = { ...root.box, x: 0, y: 0, w: width || root.box.w, h: height || root.box.h };

  const wrapEl = childElements(container).find((el) => el.name in WRAP_TAGS);
  const a = container.attrs;
  return {
    inline,
    width: root.box.w,
    height: root.box.h,
    wrap: inline ? "inline" : wrapEl ? WRAP_TAGS[wrapEl.name] : "none",
    behindDoc: a.behindDoc === "1",
    zIndex: Number(a.relativeHeight) || 0,
    distance: [px(a.distT), px(a.distR), px(a.distB), px(a.distL)],
    horizontal: parsePosition(child(container, "wp:positionH"), "column"),
    vertical: parsePosition(child(container, "wp:positionV"), "paragraph"),
    root,
  };
}
