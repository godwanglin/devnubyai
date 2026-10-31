import { DEFAULT_CLR_MAP, parseDrawingTheme, type DrawingColorScheme } from "@/lib/files/parsers/drawingml";
import { parseDocxDrawing, type DocxDrawing, type DrawingNode } from "@/lib/files/parsers/docx-drawing";
import { childElements, parseXml, renderableImageMime, resolveZipPath, type XmlElement } from "@/lib/files/parsers/xml";
import { loadZip, readZipBase64, readZipText, readZipXml, type ZipArchive } from "@/lib/files/parsers/zip";

/**
 * Rewrites a .docx before docx-preview sees it, covering what that library gets wrong:
 *
 * - Floating drawings (`wp:anchor`) and inline shapes/groups are swapped for bookmark
 *   markers and modelled here instead; docx-preview has no DrawingML shape support and
 *   cannot position anchors on the page. Text-box contents go into a second, synthetic
 *   document so docx-preview still renders their paragraphs with full Word formatting.
 * - `w:tblInd` is written with `w:w`, but docx-preview only reads `w:left`.
 * - Fonts that are neither embedded nor installed fall back to the font table's
 *   `w:altName` / family class, as Word does, instead of the browser default.
 */

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

export interface PreparedDocx {
  main: Blob;
  /** Synthetic document holding every text box's paragraphs, or null when there are none. */
  textBoxes: Blob | null;
  textBoxCount: number;
  drawings: DocxDrawing[];
  /** Bookmark-name prefix of drawing (`<prefix>d<n>`) and text-box (`<prefix>t<n>`) markers. */
  markerPrefix: string;
  /** zip path → data URL for pictures the drawings reference. */
  media: Map<string, string>;
  /** Lower-cased font name → substitute families, in order. */
  fontFallbacks: Map<string, string[]>;
}

interface Rel {
  type: string;
  target: string;
}

async function readRels(zip: ZipArchive, partPath: string): Promise<Map<string, Rel>> {
  const slash = partPath.lastIndexOf("/");
  const relsXml = await readZipXml(zip, `${partPath.slice(0, slash + 1)}_rels/${partPath.slice(slash + 1)}.rels`);
  const rels = new Map<string, Rel>();
  for (const rel of childElements(relsXml ? childElements(relsXml)[0] : undefined)) {
    const { Id: id, Target: target, Type: type, TargetMode: mode } = rel.attrs;
    if (!id || !target || mode === "External") continue;
    rels.set(id, { type: type ?? "", target: resolveZipPath(partPath, target) });
  }
  return rels;
}

function relsByType(rels: Map<string, Rel>, suffix: string): string[] {
  return [...rels.values()].filter((r) => r.type.endsWith(suffix)).map((r) => r.target);
}

function hasAncestor(el: Element, localName: string, stop: Element | null): boolean {
  for (let p = el.parentElement; p && p !== stop; p = p.parentElement) {
    if (p.localName === localName) return true;
  }
  return false;
}

/** docx-preview reads table indentation from `w:left`; Word writes it as `w:w`. */
function fixTableIndents(doc: Document) {
  for (const ind of Array.from(doc.getElementsByTagNameNS(W_NS, "tblInd"))) {
    const width = ind.getAttributeNS(W_NS, "w");
    const type = ind.getAttributeNS(W_NS, "type");
    if (width && !ind.hasAttributeNS(W_NS, "left") && (!type || type === "dxa")) {
      ind.setAttributeNS(W_NS, "w:left", width);
    }
  }
}

function makeMarker(doc: Document, name: string, id: number): Element {
  const marker = doc.createElementNS(W_NS, "w:bookmarkStart");
  marker.setAttributeNS(W_NS, "w:id", String(900000 + id));
  marker.setAttributeNS(W_NS, "w:name", name);
  return marker;
}

/** The node docx-preview would otherwise render for this drawing: its AlternateContent or w:drawing. */
function replaceableNode(container: Element): Element | null {
  const drawing = container.parentElement;
  if (!drawing || drawing.localName !== "drawing") return null;
  const choice = drawing.parentElement;
  if (choice?.localName === "Choice" && choice.parentElement?.localName === "AlternateContent") {
    return choice.parentElement;
  }
  return drawing;
}

/** Text-box contents directly owned by this drawing (not nested inside another text box). */
function ownTextBoxes(container: Element): Element[] {
  return Array.from(container.getElementsByTagNameNS(W_NS, "txbxContent")).filter(
    (el) => !hasAncestor(el, "txbxContent", container)
  );
}

interface PartResult {
  xml: string;
  textBoxes: Element[];
}

function extractDrawings(
  source: string,
  rels: Map<string, Rel>,
  scheme: DrawingColorScheme,
  prefix: string,
  drawings: DocxDrawing[],
  textBoxCount: { value: number }
): PartResult {
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return { xml: source, textBoxes: [] };
  fixTableIndents(doc);

  const imageRels = new Map([...rels].map(([id, rel]) => [id, rel.target]));
  const serializer = new XMLSerializer();
  const textBoxes: Element[] = [];
  const containers = [
    ...Array.from(doc.getElementsByTagNameNS(WP_NS, "anchor")),
    ...Array.from(doc.getElementsByTagNameNS(WP_NS, "inline")),
  ];

  for (const container of containers) {
    // drawings inside text boxes stay with docx-preview, which renders the box contents
    if (hasAncestor(container, "txbxContent", null)) continue;
    const node = replaceableNode(container);
    const run = node?.parentElement;
    if (!node || !run || run.localName !== "r" || !run.parentElement) continue;

    const ctx = { scheme, rels: imageRels, textBoxes: [] as XmlElement[] };
    const parsed = childElements(parseXml(serializer.serializeToString(container)))[0];
    const drawing = parsed ? parseDocxDrawing(parsed, ctx) : null;
    // plain inline pictures render fine in docx-preview; keep them in the text flow there
    if (!drawing || (drawing.inline && drawing.root.kind === "picture")) continue;

    const own = ownTextBoxes(container);
    if (own.length === ctx.textBoxes.length) {
      shiftTextBoxIndexes(drawing.root, textBoxCount.value);
      textBoxCount.value += own.length;
      textBoxes.push(...own.map((el) => el.cloneNode(true) as Element));
    } else {
      // a text box sits in something this model skips; drop text rather than misplace it
      clearTextBoxes(drawing.root);
    }

    run.parentElement.insertBefore(makeMarker(doc, `${prefix}d${drawings.length}`, drawings.length), run);
    node.remove();
    drawings.push(drawing);
  }
  return { xml: serializer.serializeToString(doc), textBoxes };
}

function shiftTextBoxIndexes(node: DrawingNode, offset: number) {
  if (node.kind === "shape" && node.textBox !== null) node.textBox += offset;
  if (node.kind === "group") node.children.forEach((c) => shiftTextBoxIndexes(c, offset));
}

function clearTextBoxes(node: DrawingNode) {
  if (node.kind === "shape") node.textBox = null;
  if (node.kind === "group") node.children.forEach(clearTextBoxes);
}

/** A copy of the main document whose body is every text box's content between markers. */
function buildTextBoxDocument(mainXml: string, boxes: Element[], prefix: string): string | null {
  const doc = new DOMParser().parseFromString(mainXml, "application/xml");
  const body = doc.getElementsByTagNameNS(W_NS, "body")[0];
  if (!body) return null;
  const sectPr = Array.from(body.children).find((el) => el.localName === "sectPr");
  body.replaceChildren();
  const markerParagraph = (name: string, id: number) => {
    const p = doc.createElementNS(W_NS, "w:p");
    p.appendChild(makeMarker(doc, name, id));
    return p;
  };
  boxes.forEach((box, i) => {
    body.appendChild(markerParagraph(`${prefix}t${i}`, 100000 + i));
    for (const el of Array.from(box.children)) body.appendChild(doc.importNode(el, true));
  });
  body.appendChild(markerParagraph(`${prefix}t${boxes.length}`, 100000 + boxes.length));
  if (sectPr) body.appendChild(sectPr);
  return new XMLSerializer().serializeToString(doc);
}

const GENERIC_FALLBACKS: Record<string, string[]> = {
  swiss: ["Arial", "Helvetica", "Liberation Sans", "sans-serif"],
  roman: ["Times New Roman", "Times", "Liberation Serif", "serif"],
  modern: ["Courier New", "Courier", "Liberation Mono", "monospace"],
  script: ["cursive"],
  decorative: ["fantasy"],
};

/**
 * Per font in the font table, the families to try after it: its `w:altName`, then the
 * class named by `w:family` — Word's own substitution order for fonts it doesn't have.
 */
async function readFontFallbacks(zip: ZipArchive): Promise<Map<string, string[]>> {
  const table = await readZipXml(zip, "word/fontTable.xml");
  const fonts = childElements(table ? childElements(table)[0] : undefined, "w:font");
  const fallbacks = new Map<string, string[]>();
  for (const font of fonts) {
    const name = font.attrs["w:name"];
    if (!name) continue;
    const props = new Map(
      font.children.flatMap((c) => (typeof c === "string" ? [] : [[c.name, c.attrs["w:val"] ?? ""] as const]))
    );
    const chain = [props.get("w:altName"), ...(GENERIC_FALLBACKS[props.get("w:family") ?? ""] ?? [])]
      .filter((v): v is string => Boolean(v) && v !== name);
    if (chain.length) fallbacks.set(name.toLowerCase(), [...new Set(chain)]);
  }
  return fallbacks;
}

function collectMediaPaths(node: DrawingNode, out: Set<string>) {
  if (node.kind === "picture" && node.mediaPath) out.add(node.mediaPath);
  if (node.kind === "group") node.children.forEach((c) => collectMediaPaths(c, out));
}

async function loadMedia(zip: ZipArchive, drawings: DocxDrawing[]): Promise<Map<string, string>> {
  const paths = new Set<string>();
  drawings.forEach((d) => collectMediaPaths(d.root, paths));
  const media = new Map<string, string>();
  for (const mediaPath of paths) {
    const mime = renderableImageMime(mediaPath);
    if (!mime) continue;
    const base64 = await readZipBase64(zip, mediaPath);
    if (base64 && base64.length * 0.75 <= MAX_MEDIA_BYTES) media.set(mediaPath, `data:${mime};base64,${base64}`);
  }
  return media;
}

export async function prepareDocx(bytes: ArrayBuffer): Promise<PreparedDocx> {
  const zip = await loadZip(bytes.slice(0));
  const mainPath = "word/document.xml";
  const docRels = await readRels(zip, mainPath);
  const themePath = relsByType(docRels, "/theme")[0];
  const theme = parseDrawingTheme(themePath ? await readZipXml(zip, themePath) : null);
  const scheme: DrawingColorScheme = { colors: theme.colors, clrMap: DEFAULT_CLR_MAP };

  const markerPrefix = `_dn${Math.random().toString(36).slice(2, 8)}`;
  const drawings: DocxDrawing[] = [];
  const textBoxCount = { value: 0 };
  const allTextBoxes: Element[] = [];

  const parts = [mainPath, ...relsByType(docRels, "/header"), ...relsByType(docRels, "/footer")];
  let mainXml = "";
  for (const partPath of parts) {
    const source = await readZipText(zip, partPath);
    if (source === null) continue;
    const rels = partPath === mainPath ? docRels : await readRels(zip, partPath);
    const result = extractDrawings(source, rels, scheme, markerPrefix, drawings, textBoxCount);
    allTextBoxes.push(...result.textBoxes);
    zip.file(partPath, result.xml);
    if (partPath === mainPath) mainXml = result.xml;
  }

  const main = await zip.generateAsync({ type: "blob" });
  let textBoxes: Blob | null = null;
  const boxXml = allTextBoxes.length ? buildTextBoxDocument(mainXml, allTextBoxes, markerPrefix) : null;
  if (boxXml) {
    zip.file(mainPath, boxXml);
    textBoxes = await zip.generateAsync({ type: "blob" });
  }

  return {
    main,
    textBoxes,
    textBoxCount: allTextBoxes.length,
    drawings,
    markerPrefix,
    media: await loadMedia(zip, drawings),
    fontFallbacks: await readFontFallbacks(zip),
  };
}
