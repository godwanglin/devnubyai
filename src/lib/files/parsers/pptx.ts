import {
  child,
  childElements,
  path,
  renderableImageMime,
  resolveZipPath,
  textContent,
  type XmlElement,
} from "./xml";
import { loadZip, readZipBytes, readZipXml, zipEntrySize, type ZipArchive } from "./zip";
import {
  DEFAULT_CLR_MAP,
  drawingColorChild,
  parseDrawingTheme,
  resolveDrawingColor,
  resolveDrawingFill,
  type DrawingColorScheme,
  type DrawingTheme,
} from "./drawingml";
import { chartToText, parseChartXml, type PptxChart, type ChartColorResolver } from "./pptx-chart";

/**
 * PowerPoint (.pptx) parser producing a positioned slide model for the side-panel
 * preview. Resolves placeholder geometry and text styles through the
 * slide → layout → master chain, theme colors/fonts, groups, tables and images.
 * All geometry is expressed in points (1pt = 12700 EMU).
 */

const EMU_PER_PT = 12700;
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_MEDIA_BYTES = 80 * 1024 * 1024;

export interface PptxBox {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export interface PptxRun {
  text: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  font: string | null;
  baseline: number;
  caps: "none" | "all" | "small";
}

export interface PptxParagraph {
  align: "left" | "center" | "right" | "justify";
  level: number;
  marginLeft: number;
  indent: number;
  bullet: string | null;
  lineHeight: number;
  spaceBefore: number;
  spaceAfter: number;
  emptySize: number;
  runs: PptxRun[];
}

export interface PptxTextBody {
  anchor: "top" | "middle" | "bottom";
  insets: [number, number, number, number];
  wrap: boolean;
  paragraphs: PptxParagraph[];
}

export interface PptxTableCell {
  paragraphs: PptxParagraph[];
  fill: string | null;
  colSpan: number;
  rowSpan: number;
  merged: boolean;
}

export type PptxShape =
  | {
      kind: "shape";
      box: PptxBox;
      fill: string | null;
      line: { color: string; width: number } | null;
      geometry: "rect" | "roundRect" | "ellipse";
      text: PptxTextBody | null;
    }
  | { kind: "image"; box: PptxBox; mediaPath: string }
  | { kind: "line"; box: PptxBox; color: string; width: number }
  | { kind: "table"; box: PptxBox; columns: number[]; rows: { height: number; cells: PptxTableCell[] }[] }
  | { kind: "embed"; box: PptxBox; label: "chart" | "diagram" | "image" | "object" }
  | { kind: "chart"; box: PptxBox; chartPath: string };

export interface PptxSlide {
  number: number;
  hidden: boolean;
  background: { fill: string | null; mediaPath: string | null };
  shapes: PptxShape[];
  notes: string;
}

export interface PptxMedia {
  bytes: Uint8Array;
  mime: string;
}

export interface PptxDocument {
  width: number;
  height: number;
  slides: PptxSlide[];
  media: Map<string, PptxMedia>;
  charts: Map<string, PptxChart>;
}

interface Part {
  path: string;
  xml: XmlElement;
  root: XmlElement;
  rels: Map<string, { type: string; target: string }>;
}

type Theme = DrawingTheme;

interface MasterInfo {
  part: Part;
  theme: Theme;
  clrMap: Record<string, string>;
  titleStyle?: XmlElement;
  bodyStyle?: XmlElement;
  otherStyle?: XmlElement;
}

interface PartChain {
  slide: Part;
  layout: Part | null;
  master: MasterInfo;
}

interface PlaceholderRef {
  type: string;
  idx: string | null;
}

// ---------------------------------------------------------------------------
// Parts & relationships
// ---------------------------------------------------------------------------

async function loadPart(zip: ZipArchive, partPath: string): Promise<Part | null> {
  const xml = await readZipXml(zip, partPath);
  if (!xml) return null;
  const root = childElements(xml)[0] ?? xml;

  const slash = partPath.lastIndexOf("/");
  const relsPath = `${partPath.slice(0, slash + 1)}_rels/${partPath.slice(slash + 1)}.rels`;
  const relsXml = await readZipXml(zip, relsPath);
  const rels = new Map<string, { type: string; target: string }>();
  for (const rel of childElements(relsXml ? childElements(relsXml)[0] : undefined)) {
    const id = rel.attrs.Id;
    const target = rel.attrs.Target;
    if (!id || !target || rel.attrs.TargetMode === "External") continue;
    rels.set(id, { type: rel.attrs.Type ?? "", target: resolveZipPath(partPath, target) });
  }
  return { path: partPath, xml, root, rels };
}

function relTarget(part: Part, typeSuffix: string): string | null {
  for (const rel of part.rels.values()) {
    if (rel.type.endsWith(typeSuffix)) return rel.target;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const schemeOf = (master: MasterInfo): DrawingColorScheme => ({ colors: master.theme.colors, clrMap: master.clrMap });

/** Resolves a DrawingML color element (srgbClr, schemeClr, ...) with modifiers to CSS. */
function colorFromElement(colorEl: XmlElement | undefined, master: MasterInfo, phColor?: string): string | null {
  return resolveDrawingColor(colorEl, schemeOf(master), phColor);
}

const colorChild = drawingColorChild;

/**
 * CSS background for a fill-bearing element (spPr, bgPr, tcPr...).
 * Returns undefined when the element doesn't specify a fill, null for "no fill".
 */
function fillFromProps(props: XmlElement | undefined, master: MasterInfo, phColor?: string): string | null | undefined {
  return resolveDrawingFill(props, schemeOf(master), phColor);
}

// ---------------------------------------------------------------------------
// Theme & master
// ---------------------------------------------------------------------------

async function loadTheme(zip: ZipArchive, themePath: string | null): Promise<Theme> {
  return parseDrawingTheme(themePath ? await readZipXml(zip, themePath) : null);
}

async function loadMaster(zip: ZipArchive, masterPath: string): Promise<MasterInfo | null> {
  const part = await loadPart(zip, masterPath);
  if (!part) return null;
  const theme = await loadTheme(zip, relTarget(part, "/theme"));
  const clrMapEl = child(part.root, "p:clrMap");
  const clrMap: Record<string, string> = {
    ...DEFAULT_CLR_MAP,
    ...(clrMapEl?.attrs ?? {}),
  };
  const txStyles = child(part.root, "p:txStyles");
  return {
    part,
    theme,
    clrMap,
    titleStyle: child(txStyles, "p:titleStyle"),
    bodyStyle: child(txStyles, "p:bodyStyle"),
    otherStyle: child(txStyles, "p:otherStyle"),
  };
}

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

function nvProps(shape: XmlElement): XmlElement | undefined {
  const nv = childElements(shape).find((c) => c.name.startsWith("p:nv"));
  return nv;
}

function placeholderOf(shape: XmlElement): PlaceholderRef | null {
  const ph = path(nvProps(shape), "p:nvPr", "p:ph");
  if (!ph) return null;
  return { type: ph.attrs.type ?? "obj", idx: ph.attrs.idx ?? null };
}

function normalizePhType(type: string): string {
  if (type === "ctrTitle") return "title";
  if (type === "subTitle" || type === "obj" || type === "body") return "body";
  return type;
}

function findPlaceholder(part: Part | null, ref: PlaceholderRef, matchIdx: boolean): XmlElement | undefined {
  if (!part) return undefined;
  const tree = path(part.root, "p:cSld", "p:spTree");
  const candidates = childElements(tree).filter((c) => placeholderOf(c));
  if (matchIdx && ref.idx !== null) {
    const byIdx = candidates.find((c) => placeholderOf(c)?.idx === ref.idx);
    if (byIdx) return byIdx;
  }
  const wanted = normalizePhType(ref.type);
  return candidates.find((c) => normalizePhType(placeholderOf(c)?.type ?? "obj") === wanted);
}

function masterTextStyle(master: MasterInfo, ref: PlaceholderRef | null): XmlElement | undefined {
  if (!ref) return master.otherStyle;
  const type = normalizePhType(ref.type);
  if (type === "title") return master.titleStyle;
  if (type === "body") return master.bodyStyle;
  return master.otherStyle;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

type Transform = (box: PptxBox) => PptxBox;
const identity: Transform = (b) => b;

function boxFromXfrm(xfrm: XmlElement | undefined): PptxBox | null {
  const off = child(xfrm, "a:off");
  const ext = child(xfrm, "a:ext");
  if (!off || !ext) return null;
  return {
    x: Number(off.attrs.x ?? 0) / EMU_PER_PT,
    y: Number(off.attrs.y ?? 0) / EMU_PER_PT,
    w: Number(ext.attrs.cx ?? 0) / EMU_PER_PT,
    h: Number(ext.attrs.cy ?? 0) / EMU_PER_PT,
    rotation: Number(xfrm?.attrs.rot ?? 0) / 60000,
    flipH: xfrm?.attrs.flipH === "1",
    flipV: xfrm?.attrs.flipV === "1",
  };
}

function shapeXfrm(shape: XmlElement): XmlElement | undefined {
  if (shape.name === "p:graphicFrame") return child(shape, "p:xfrm");
  const props = child(shape, "p:spPr") ?? child(shape, "p:grpSpPr");
  return child(props, "a:xfrm");
}

function resolveBox(shape: XmlElement, chain: PartChain, ref: PlaceholderRef | null): PptxBox | null {
  const own = boxFromXfrm(shapeXfrm(shape));
  if (own) return own;
  if (!ref) return null;
  const layoutPh = findPlaceholder(chain.layout, ref, true);
  const layoutBox = layoutPh ? boxFromXfrm(shapeXfrm(layoutPh)) : null;
  if (layoutBox) return layoutBox;
  const masterPh = findPlaceholder(chain.master.part, ref, false);
  return masterPh ? boxFromXfrm(shapeXfrm(masterPh)) : null;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

interface TextContext {
  chain: PartChain;
  /** lstStyle-like elements, most specific first */
  styleSources: (XmlElement | undefined)[];
  /** Theme color from the shape's style fontRef */
  fontRefColor: string | null;
  fontScale: number;
  lineReduction: number;
  defaultSize: number;
}

function levelProps(source: XmlElement | undefined, level: number): XmlElement | undefined {
  return child(source, `a:lvl${level + 1}pPr`);
}

function firstAttr(chain: (XmlElement | undefined)[], name: string): string | undefined {
  for (const el of chain) {
    const v = el?.attrs[name];
    if (v !== undefined) return v;
  }
  return undefined;
}

function isOn(v: string | undefined): boolean {
  return v === "1" || v === "true";
}

function resolveFont(typeface: string | undefined, theme: Theme): string | null {
  if (!typeface) return null;
  if (typeface.startsWith("+mj")) return theme.majorFont;
  if (typeface.startsWith("+mn")) return theme.minorFont;
  return typeface;
}

const ALPHA = "abcdefghijklmnopqrstuvwxyz";

function toRoman(n: number): string {
  const map: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let out = "";
  let rest = n;
  for (const [v, s] of map) {
    while (rest >= v) {
      out += s;
      rest -= v;
    }
  }
  return out;
}

function formatAutoNumber(scheme: string, n: number): string {
  const alpha = ALPHA[(n - 1) % 26] ?? "a";
  let core: string;
  if (scheme.startsWith("alphaLc")) core = alpha;
  else if (scheme.startsWith("alphaUc")) core = alpha.toUpperCase();
  else if (scheme.startsWith("romanLc")) core = toRoman(n);
  else if (scheme.startsWith("romanUc")) core = toRoman(n).toUpperCase();
  else core = String(n);

  if (scheme.endsWith("ParenBoth")) return `(${core})`;
  if (scheme.endsWith("ParenR")) return `${core})`;
  if (scheme.endsWith("Plain")) return core;
  return `${core}.`;
}

function parseParagraphs(txBody: XmlElement | undefined, ctx: TextContext): PptxParagraph[] {
  if (!txBody) return [];
  const master = ctx.chain.master;
  const paragraphs: PptxParagraph[] = [];
  const counters: number[] = [];

  for (const p of childElements(txBody, "a:p")) {
    const pPr = child(p, "a:pPr");
    const level = Math.min(Number(pPr?.attrs.lvl ?? 0) || 0, 8);
    const pChain = [pPr, ...ctx.styleSources.map((s) => levelProps(s, level))];
    const rDefaults = pChain.map((el) => child(el, "a:defRPr"));

    // Bullets: the first source that says anything about bullets wins
    let bullet: string | null = null;
    let autoNum: { scheme: string; startAt: number } | null = null;
    for (const el of pChain) {
      if (!el) continue;
      if (child(el, "a:buNone")) break;
      const buChar = child(el, "a:buChar");
      if (buChar) {
        bullet = buChar.attrs.char ?? "•";
        break;
      }
      const buAuto = child(el, "a:buAutoNum");
      if (buAuto) {
        autoNum = { scheme: buAuto.attrs.type ?? "arabicPeriod", startAt: Number(buAuto.attrs.startAt ?? 1) || 1 };
        break;
      }
      if (child(el, "a:buBlip")) {
        bullet = "•";
        break;
      }
    }

    const runs: PptxRun[] = [];
    const runFrom = (rPr: XmlElement | undefined, text: string) => {
      const chain = [rPr, ...rDefaults];
      const sizeRaw = firstAttr(chain, "sz");
      const size = (sizeRaw ? Number(sizeRaw) / 100 : ctx.defaultSize) * ctx.fontScale;

      let color: string | null = null;
      // chain = [run, paragraph, shape lstStyle, layout, master, txStyles]: colors set on the
      // shape itself beat the shape style's fontRef, which beats inherited defaults
      const OWN_SOURCES = 3;
      for (let k = 0; k < chain.length && !color; k++) {
        if (k === OWN_SOURCES && ctx.fontRefColor) {
          color = ctx.fontRefColor;
          break;
        }
        const fill = child(chain[k], "a:solidFill");
        if (fill) color = colorFromElement(colorChild(fill), master);
      }
      color ??= ctx.fontRefColor ?? colorFromElement({ name: "a:schemeClr", attrs: { val: "tx1" }, children: [] }, master);

      const latin = chain.map((el) => child(el, "a:latin")?.attrs.typeface).find(Boolean);
      const baseline = Number(firstAttr(chain, "baseline") ?? 0) / 1000;
      const cap = firstAttr(chain, "cap");

      return {
        text,
        size,
        bold: isOn(firstAttr(chain, "b")),
        italic: isOn(firstAttr(chain, "i")),
        underline: (firstAttr(chain, "u") ?? "none") !== "none",
        strike: (firstAttr(chain, "strike") ?? "noStrike") !== "noStrike",
        color: color ?? "#000000",
        font: resolveFont(latin, master.theme) ?? master.theme.minorFont,
        baseline,
        caps: cap === "all" ? "all" : cap === "small" ? "small" : "none",
      } satisfies PptxRun;
    };

    for (const r of childElements(p)) {
      if (r.name === "a:r" || r.name === "a:fld") {
        const text = textContent(child(r, "a:t"));
        if (text) runs.push(runFrom(child(r, "a:rPr"), text));
      } else if (r.name === "a:br") {
        runs.push(runFrom(child(r, "a:rPr"), "\n"));
      }
    }

    const hasText = runs.some((r) => r.text.trim());
    const endRun = runFrom(child(p, "a:endParaRPr"), "");

    if (autoNum && hasText) {
      counters.length = level + 1;
      counters[level] = (counters[level] ?? autoNum.startAt - 1) + 1;
      bullet = formatAutoNumber(autoNum.scheme, counters[level]);
    } else if (hasText) {
      counters.length = level;
    }

    const algn = firstAttr(pChain, "algn") ?? "l";
    const lnSpc = pChain.map((el) => child(el, "a:lnSpc")).find(Boolean);
    const spcPct = child(lnSpc, "a:spcPct");
    const spcPts = child(lnSpc, "a:spcPts");
    const firstSize = runs[0]?.size ?? endRun.size;
    let lineHeight = 1.2;
    if (spcPct) lineHeight = (Number(spcPct.attrs.val ?? 100000) / 100000) * 1.2;
    else if (spcPts && firstSize > 0) lineHeight = Number(spcPts.attrs.val ?? 0) / 100 / firstSize;
    lineHeight = Math.max(0.6, lineHeight * (1 - ctx.lineReduction));

    const spacing = (name: string) => {
      const el = pChain.map((e) => child(e, name)).find(Boolean);
      const pts = child(el, "a:spcPts");
      if (pts) return Number(pts.attrs.val ?? 0) / 100;
      const pct = child(el, "a:spcPct");
      if (pct) return (Number(pct.attrs.val ?? 0) / 100000) * firstSize;
      return 0;
    };

    paragraphs.push({
      align: algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "just" || algn === "dist" ? "justify" : "left",
      level,
      marginLeft: Number(firstAttr(pChain, "marL") ?? 0) / EMU_PER_PT,
      indent: Number(firstAttr(pChain, "indent") ?? 0) / EMU_PER_PT,
      bullet: hasText ? bullet : null,
      lineHeight,
      spaceBefore: spacing("a:spcBef"),
      spaceAfter: spacing("a:spcAft"),
      emptySize: endRun.size,
      runs,
    });
  }

  return paragraphs;
}

function bodyPrChain(shape: XmlElement, chain: PartChain, ref: PlaceholderRef | null): (XmlElement | undefined)[] {
  const own = path(shape, "p:txBody", "a:bodyPr");
  if (!ref) return [own];
  const layoutPh = findPlaceholder(chain.layout, ref, true);
  const masterPh = findPlaceholder(chain.master.part, ref, false);
  return [own, path(layoutPh, "p:txBody", "a:bodyPr"), path(masterPh, "p:txBody", "a:bodyPr")];
}

function parseTextBody(
  shape: XmlElement,
  chain: PartChain,
  ref: PlaceholderRef | null,
  fontRefColor: string | null
): PptxTextBody | null {
  const txBody = child(shape, "p:txBody");
  if (!txBody) return null;

  const bodyChain = bodyPrChain(shape, chain, ref);
  const autofit = child(bodyChain[0], "a:normAutofit");
  const layoutPh = ref ? findPlaceholder(chain.layout, ref, true) : undefined;
  const masterPh = ref ? findPlaceholder(chain.master.part, ref, false) : undefined;
  const phType = ref ? normalizePhType(ref.type) : null;

  const ctx: TextContext = {
    chain,
    styleSources: [
      child(txBody, "a:lstStyle"),
      path(layoutPh, "p:txBody", "a:lstStyle"),
      path(masterPh, "p:txBody", "a:lstStyle"),
      masterTextStyle(chain.master, ref),
    ],
    fontRefColor,
    fontScale: autofit?.attrs.fontScale ? Number(autofit.attrs.fontScale) / 100000 : 1,
    lineReduction: autofit?.attrs.lnSpcReduction ? Number(autofit.attrs.lnSpcReduction) / 100000 : 0,
    defaultSize: phType === "title" ? 44 : 18,
  };

  const anchor = firstAttr(bodyChain, "anchor") ?? "t";
  const inset = (name: string, fallback: number) => {
    const v = firstAttr(bodyChain, name);
    return v !== undefined ? Number(v) / EMU_PER_PT : fallback;
  };

  return {
    anchor: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
    insets: [inset("lIns", 7.2), inset("tIns", 3.6), inset("rIns", 7.2), inset("bIns", 3.6)],
    wrap: firstAttr(bodyChain, "wrap") !== "none",
    paragraphs: parseParagraphs(txBody, ctx),
  };
}

// ---------------------------------------------------------------------------
// Shape tree
// ---------------------------------------------------------------------------

interface TreeContext {
  chain: PartChain;
  /** Part whose relationships resolve r:embed ids for this tree */
  part: Part;
  skipPlaceholders: boolean;
  media: Set<string>;
  chartPaths: Set<string>;
}

function styleRefColor(shape: XmlElement, refName: string, master: MasterInfo): string | null {
  const ref = path(shape, "p:style", refName);
  if (!ref || ref.attrs.idx === "0") return null;
  return colorFromElement(colorChild(ref), master);
}

function parseShape(shape: XmlElement, tctx: TreeContext, transform: Transform): PptxShape | null {
  const { chain } = tctx;
  const master = chain.master;
  const ref = placeholderOf(shape);
  const box = resolveBox(shape, chain, ref);
  if (!box) return null;

  const spPr = child(shape, "p:spPr");
  let fill = fillFromProps(spPr, master);
  if (fill === undefined) fill = styleRefColor(shape, "a:fillRef", master);

  let line: { color: string; width: number } | null = null;
  const ln = child(spPr, "a:ln");
  const lnWidth = ln?.attrs.w ? Number(ln.attrs.w) / EMU_PER_PT : 0.75;
  const lnFill = fillFromProps(ln, master);
  if (lnFill) line = { color: lnFill, width: lnWidth };
  else if (lnFill === undefined) {
    const refColor = styleRefColor(shape, "a:lnRef", master);
    if (refColor) line = { color: refColor, width: lnWidth };
  }

  const prst = child(spPr, "a:prstGeom")?.attrs.prst ?? "rect";
  const geometry = prst === "ellipse" ? "ellipse" : prst.startsWith("round") ? "roundRect" : "rect";

  return {
    kind: "shape",
    box: transform(box),
    fill: fill ?? null,
    line,
    geometry,
    text: parseTextBody(shape, chain, ref, styleRefColor(shape, "a:fontRef", master)),
  };
}

function parsePicture(pic: XmlElement, tctx: TreeContext, transform: Transform): PptxShape | null {
  const box = resolveBox(pic, tctx.chain, placeholderOf(pic));
  if (!box) return null;
  const embed = path(pic, "p:blipFill", "a:blip")?.attrs["r:embed"];
  const target = embed ? tctx.part.rels.get(embed)?.target : undefined;
  if (!target || !renderableImageMime(target)) {
    return { kind: "embed", box: transform(box), label: "image" };
  }
  tctx.media.add(target);
  return { kind: "image", box: transform(box), mediaPath: target };
}

function parseTable(tbl: XmlElement, tctx: TreeContext): Omit<Extract<PptxShape, { kind: "table" }>, "box"> {
  const master = tctx.chain.master;
  const columns = childElements(child(tbl, "a:tblGrid"), "a:gridCol").map((c) => Number(c.attrs.w ?? 0) / EMU_PER_PT);
  const textCtx: TextContext = {
    chain: tctx.chain,
    styleSources: [],
    fontRefColor: null,
    fontScale: 1,
    lineReduction: 0,
    defaultSize: 18,
  };
  const rows = childElements(tbl, "a:tr").map((tr) => ({
    height: Number(tr.attrs.h ?? 0) / EMU_PER_PT,
    cells: childElements(tr, "a:tc").map((tc) => ({
      paragraphs: parseParagraphs(child(tc, "a:txBody"), textCtx),
      fill: fillFromProps(child(tc, "a:tcPr"), master) ?? null,
      colSpan: Number(tc.attrs.gridSpan ?? 1) || 1,
      rowSpan: Number(tc.attrs.rowSpan ?? 1) || 1,
      merged: tc.attrs.hMerge === "1" || tc.attrs.vMerge === "1",
    })),
  }));
  return { kind: "table", columns, rows };
}

function parseGraphicFrame(frame: XmlElement, tctx: TreeContext, transform: Transform): PptxShape | null {
  const box = resolveBox(frame, tctx.chain, placeholderOf(frame));
  if (!box) return null;
  const data = path(frame, "a:graphic", "a:graphicData");
  const uri = data?.attrs.uri ?? "";
  const tbl = child(data, "a:tbl");
  if (tbl) return { ...parseTable(tbl, tctx), box: transform(box) };
  if (uri.includes("/chart")) {
    const chartRel = child(data, "c:chart");
    const relId = chartRel?.attrs["r:id"];
    const chartPath = relId ? tctx.part.rels.get(relId)?.target : undefined;
    if (chartPath) {
      tctx.chartPaths.add(chartPath);
      return { kind: "chart", box: transform(box), chartPath };
    }
    return { kind: "embed", box: transform(box), label: "chart" };
  }
  if (uri.includes("/diagram")) return { kind: "embed", box: transform(box), label: "diagram" };
  return { kind: "embed", box: transform(box), label: "object" };
}

function groupTransform(grp: XmlElement, parent: Transform): Transform {
  const xfrm = child(child(grp, "p:grpSpPr"), "a:xfrm");
  const off = child(xfrm, "a:off");
  const ext = child(xfrm, "a:ext");
  const chOff = child(xfrm, "a:chOff");
  const chExt = child(xfrm, "a:chExt");
  if (!off || !ext || !chOff || !chExt) return parent;

  const ox = Number(off.attrs.x ?? 0) / EMU_PER_PT;
  const oy = Number(off.attrs.y ?? 0) / EMU_PER_PT;
  const cx = Number(chOff.attrs.x ?? 0) / EMU_PER_PT;
  const cy = Number(chOff.attrs.y ?? 0) / EMU_PER_PT;
  const sx = Number(chExt.attrs.cx) ? Number(ext.attrs.cx ?? 0) / Number(chExt.attrs.cx) : 1;
  const sy = Number(chExt.attrs.cy) ? Number(ext.attrs.cy ?? 0) / Number(chExt.attrs.cy) : 1;

  return (b) =>
    parent({
      ...b,
      x: ox + (b.x - cx) * sx,
      y: oy + (b.y - cy) * sy,
      w: b.w * sx,
      h: b.h * sy,
    });
}

function isHidden(shape: XmlElement): boolean {
  const cNvPr = childElements(nvProps(shape)).find((c) => c.name === "p:cNvPr");
  return cNvPr?.attrs.hidden === "1";
}

function parseTree(tree: XmlElement | undefined, tctx: TreeContext, transform: Transform, out: PptxShape[]) {
  for (const el of childElements(tree)) {
    if (el.name === "mc:AlternateContent") {
      const branch = child(el, "mc:Fallback") ?? child(el, "mc:Choice");
      parseTree(branch, tctx, transform, out);
      continue;
    }
    if (!["p:sp", "p:pic", "p:cxnSp", "p:grpSp", "p:graphicFrame"].includes(el.name)) continue;
    if (isHidden(el)) continue;
    if (tctx.skipPlaceholders && placeholderOf(el)) continue;

    let shape: PptxShape | null = null;
    switch (el.name) {
      case "p:sp":
        shape = parseShape(el, tctx, transform);
        break;
      case "p:pic":
        shape = parsePicture(el, tctx, transform);
        break;
      case "p:cxnSp": {
        const box = boxFromXfrm(shapeXfrm(el));
        if (!box) break;
        const ln = child(child(el, "p:spPr"), "a:ln");
        const lnFill = fillFromProps(ln, tctx.chain.master);
        const color = lnFill ?? (lnFill === undefined ? styleRefColor(el, "a:lnRef", tctx.chain.master) : null);
        if (color) {
          shape = {
            kind: "line",
            box: transform(box),
            color,
            width: ln?.attrs.w ? Number(ln.attrs.w) / EMU_PER_PT : 0.75,
          };
        }
        break;
      }
      case "p:grpSp":
        parseTree(el, tctx, groupTransform(el, transform), out);
        break;
      case "p:graphicFrame":
        shape = parseGraphicFrame(el, tctx, transform);
        break;
    }
    if (shape) out.push(shape);
  }
}

function resolveBackground(chain: PartChain, media: Set<string>): PptxSlide["background"] {
  const parts: Part[] = [chain.slide, ...(chain.layout ? [chain.layout] : []), chain.master.part];
  for (const part of parts) {
    const bg = path(part.root, "p:cSld", "p:bg");
    if (!bg) continue;

    const bgPr = child(bg, "p:bgPr");
    if (bgPr) {
      const blip = path(bgPr, "a:blipFill", "a:blip");
      const target = blip?.attrs["r:embed"] ? part.rels.get(blip.attrs["r:embed"])?.target : undefined;
      if (target && renderableImageMime(target)) {
        media.add(target);
        return { fill: null, mediaPath: target };
      }
      const fill = fillFromProps(bgPr, chain.master);
      if (fill !== undefined) return { fill, mediaPath: null };
    }
    const bgRef = child(bg, "p:bgRef");
    if (bgRef) {
      return { fill: colorFromElement(colorChild(bgRef), chain.master), mediaPath: null };
    }
  }
  return { fill: colorFromElement({ name: "a:schemeClr", attrs: { val: "bg1" }, children: [] }, chain.master), mediaPath: null };
}

async function readNotes(zip: ZipArchive, slide: Part): Promise<string> {
  const notesPath = relTarget(slide, "/notesSlide");
  if (!notesPath) return "";
  const notes = await loadPart(zip, notesPath);
  const tree = path(notes?.root, "p:cSld", "p:spTree");
  const lines: string[] = [];
  for (const sp of childElements(tree, "p:sp")) {
    const type = placeholderOf(sp)?.type;
    if (type !== "body") continue;
    for (const p of childElements(child(sp, "p:txBody"), "a:p")) {
      lines.push(
        childElements(p)
          .map((r) => (r.name === "a:br" ? "\n" : textContent(child(r, "a:t"))))
          .join("")
      );
    }
  }
  return lines.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function parsePptx(
  input: Uint8Array | ArrayBuffer,
  options: { withMedia?: boolean } = {}
): Promise<PptxDocument> {
  const withMedia = options.withMedia ?? true;
  const zip = await loadZip(input);
  const presentation = await loadPart(zip, "ppt/presentation.xml");
  if (!presentation) throw new Error("Not a valid PowerPoint presentation (.pptx).");

  const sldSz = child(presentation.root, "p:sldSz");
  const width = Number(sldSz?.attrs.cx ?? 12192000) / EMU_PER_PT;
  const height = Number(sldSz?.attrs.cy ?? 6858000) / EMU_PER_PT;

  let slidePaths = childElements(child(presentation.root, "p:sldIdLst"), "p:sldId")
    .map((s) => presentation.rels.get(s.attrs["r:id"] ?? "")?.target)
    .filter((p): p is string => Boolean(p));
  if (slidePaths.length === 0) {
    slidePaths = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
  }

  const masters = new Map<string, MasterInfo | null>();
  const layouts = new Map<string, Part | null>();
  const mediaPaths = new Set<string>();
  const chartResolvers = new Map<string, ChartColorResolver>();
  const slides: PptxSlide[] = [];

  for (let i = 0; i < slidePaths.length; i++) {
    const slide = await loadPart(zip, slidePaths[i]);
    if (!slide) continue;

    const layoutPath = relTarget(slide, "/slideLayout");
    if (layoutPath && !layouts.has(layoutPath)) layouts.set(layoutPath, await loadPart(zip, layoutPath));
    const layout = layoutPath ? layouts.get(layoutPath) ?? null : null;

    const masterPath = layout ? relTarget(layout, "/slideMaster") : null;
    if (masterPath && !masters.has(masterPath)) masters.set(masterPath, await loadMaster(zip, masterPath));
    let master = masterPath ? masters.get(masterPath) ?? null : null;
    if (!master) {
      master = {
        part: slide,
        theme: { colors: new Map([["dk1", "000000"], ["lt1", "FFFFFF"]]), majorFont: null, minorFont: null },
        clrMap: { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" },
      };
    }

    const chain: PartChain = { slide, layout, master };
    const shapes: PptxShape[] = [];

    // Decorative (non-placeholder) shapes inherited from the master and layout
    const showMaster = slide.root.attrs.showMasterSp !== "0";
    const chartPaths = new Set<string>();
    const chartResolver: ChartColorResolver = {
      fill: (props) => fillFromProps(props, master),
      color: (fillEl) => colorFromElement(colorChild(fillEl), master),
      accent: (index) => {
        const names = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];
        const val = master.theme.colors.get(names[index % names.length]) ?? "4472c4";
        return `#${val}`;
      },
      textColor: "#000000",
      font: master.theme.minorFont,
    };

    if (showMaster && layout?.root.attrs.showMasterSp !== "0" && master.part !== slide) {
      parseTree(
        path(master.part.root, "p:cSld", "p:spTree"),
        { chain, part: master.part, skipPlaceholders: true, media: mediaPaths, chartPaths },
        identity,
        shapes
      );
    }
    if (showMaster && layout) {
      parseTree(
        path(layout.root, "p:cSld", "p:spTree"),
        { chain, part: layout, skipPlaceholders: true, media: mediaPaths, chartPaths },
        identity,
        shapes
      );
    }
    parseTree(
      path(slide.root, "p:cSld", "p:spTree"),
      { chain, part: slide, skipPlaceholders: false, media: mediaPaths, chartPaths },
      identity,
        shapes
      );

    for (const cp of chartPaths) chartResolvers.set(cp, chartResolver);

    slides.push({
      number: i + 1,
      hidden: slide.root.attrs.show === "0",
      background: resolveBackground(chain, mediaPaths),
      shapes,
      notes: await readNotes(zip, slide),
    });
  }

  const media = new Map<string, PptxMedia>();
  let total = 0;
  for (const mediaPath of withMedia ? mediaPaths : []) {
    const mime = renderableImageMime(mediaPath);
    if (!mime) continue;
    const size = zipEntrySize(zip, mediaPath);
    if (size > MAX_MEDIA_BYTES || total + size > MAX_TOTAL_MEDIA_BYTES) continue;
    const bytes = await readZipBytes(zip, mediaPath);
    if (!bytes) continue;
    total += bytes.byteLength;
    media.set(mediaPath, { bytes, mime });
  }

  const charts = new Map<string, PptxChart>();
  for (const [chartPath, resolver] of chartResolvers) {
    const xml = await readZipXml(zip, chartPath);
    if (xml) {
      const parsed = parseChartXml(xml, resolver);
      if (parsed) charts.set(chartPath, parsed);
    }
  }

  return { width, height, slides, media, charts };
}

/** Plain-text outline of a parsed deck (used for search and AI context). */
export function pptxToText(doc: PptxDocument): string {
  const out: string[] = [];
  for (const slide of doc.slides) {
    const lines: string[] = [];
    for (const shape of slide.shapes) {
      if (shape.kind === "shape" && shape.text) {
        for (const p of shape.text.paragraphs) {
          const text = p.runs.map((r) => r.text).join("").trim();
          if (text) lines.push(`${"  ".repeat(p.level)}${p.bullet ? `${p.bullet} ` : ""}${text}`);
        }
      } else if (shape.kind === "table") {
        for (const row of shape.rows) {
          const cells = row.cells
            .filter((c) => !c.merged)
            .map((c) => c.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join(" ").trim());
          lines.push(`| ${cells.join(" | ")} |`);
        }
      } else if (shape.kind === "chart") {
        const chart = doc.charts.get(shape.chartPath);
        if (chart) lines.push(chartToText(chart));
      }
    }
    if (lines.length || slide.notes) {
      out.push(`=== [SLIDE ${slide.number}] ===\n${lines.join("\n")}${slide.notes ? `\n[Notes] ${slide.notes}` : ""}`);
    }
  }
  return out.join("\n\n");
}
