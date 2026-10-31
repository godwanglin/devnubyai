import { childElements, findFirst, localName, resolveZipPath, textContent, type XmlElement } from "./xml";
import { loadZip, readZipText, readZipXml, type ZipArchive } from "./zip";
import { parseXml } from "./xml";

/**
 * Word (.docx) → Markdown-flavoured text for the AI.
 *
 * Keeps headings, numbered/bulleted lists, tables (`| a | b |` rows), hyperlinks,
 * text boxes, header/footer and footnotes. A DOCX stores no page numbers: layout is
 * computed when rendering. Word does, however, record where pages broke the last time
 * it laid the document out (`w:lastRenderedPageBreak`), so `=== [PAGE X] ===` markers
 * are emitted only when those exist. Without them, hard page breaks are kept as
 * `--- [PAGE BREAK] ---` lines and no page numbers are claimed.
 */

export interface DocxTextResult {
  text: string;
  /** Pages from Word's rendered page breaks, or null when the file stores no pagination */
  pageCount: number | null;
}

interface StyleInfo {
  name: string;
  basedOn?: string;
  outlineLevel?: number;
  numId?: string;
  ilvl?: number;
  pageBreakBefore?: boolean;
}

interface Relationship {
  target: string;
  external: boolean;
}

interface Ctx {
  styles: Map<string, StyleInfo>;
  /** numId → ilvl → numFmt */
  numbering: Map<string, Map<number, string>>;
  rels: Map<string, Relationship>;
  rendered: boolean;
  page: number;
  pageHasContent: boolean;
  counters: Map<string, number[]>;
  footnoteRefs: string[];
  endnoteRefs: string[];
}

type Piece =
  | { kind: "text"; text: string; bold: boolean; italic: boolean; link?: string }
  | { kind: "break"; rendered: boolean };

type Mode = "body" | "nested";

const ln = (el: XmlElement) => localName(el.name);

function attr(el: XmlElement | undefined, key: string): string | undefined {
  if (!el) return undefined;
  if (key in el.attrs) return el.attrs[key];
  for (const k in el.attrs) {
    if (k.endsWith(`:${key}`)) return el.attrs[k];
  }
  return undefined;
}

function kid(el: XmlElement | undefined, local: string): XmlElement | undefined {
  return childElements(el).find((c) => ln(c) === local);
}

function kids(el: XmlElement | undefined, local: string): XmlElement[] {
  return childElements(el).filter((c) => ln(c) === local);
}

/** OOXML toggle property: present without val, or val not 0/false/none. */
function isOn(el: XmlElement | undefined): boolean {
  if (!el) return false;
  const v = attr(el, "val");
  return v === undefined || !["0", "false", "off", "none"].includes(v.toLowerCase());
}

function rootOf(xml: XmlElement | null, local: string): XmlElement | undefined {
  return xml ? childElements(xml).find((c) => ln(c) === local) : undefined;
}

function relsPathFor(partPath: string): string {
  const idx = partPath.lastIndexOf("/");
  return `${partPath.slice(0, idx + 1)}_rels/${partPath.slice(idx + 1)}.rels`;
}

async function readRels(zip: ZipArchive, partPath: string): Promise<Map<string, Relationship>> {
  const out = new Map<string, Relationship>();
  const root = rootOf(await readZipXml(zip, relsPathFor(partPath)), "relationships");
  for (const rel of kids(root, "relationship")) {
    const id = rel.attrs.Id;
    const target = rel.attrs.Target;
    if (!id || !target) continue;
    const external = rel.attrs.TargetMode === "External";
    out.set(id, { target: external ? target : resolveZipPath(partPath, target), external });
  }
  return out;
}

function parseStyles(xml: XmlElement | null): Map<string, StyleInfo> {
  const styles = new Map<string, StyleInfo>();
  for (const style of kids(rootOf(xml, "styles"), "style")) {
    const id = attr(style, "styleId");
    if (!id) continue;
    const pPr = kid(style, "pPr");
    const numPr = kid(pPr, "numPr");
    const outline = attr(kid(pPr, "outlineLvl"), "val");
    const ilvl = attr(kid(numPr, "ilvl"), "val");
    styles.set(id, {
      name: attr(kid(style, "name"), "val") ?? id,
      basedOn: attr(kid(style, "basedOn"), "val"),
      outlineLevel: outline !== undefined ? Number(outline) : undefined,
      numId: attr(kid(numPr, "numId"), "val"),
      ilvl: ilvl !== undefined ? Number(ilvl) : undefined,
      pageBreakBefore: kid(pPr, "pageBreakBefore") ? isOn(kid(pPr, "pageBreakBefore")) : undefined,
    });
  }
  return styles;
}

function parseNumbering(xml: XmlElement | null): Map<string, Map<number, string>> {
  const root = rootOf(xml, "numbering");
  const levelsOf = (el: XmlElement | undefined) => {
    const levels = new Map<number, string>();
    for (const lvl of kids(el, "lvl")) {
      levels.set(Number(attr(lvl, "ilvl") ?? 0), attr(kid(lvl, "numFmt"), "val") ?? "decimal");
    }
    return levels;
  };

  const abstracts = new Map<string, Map<number, string>>();
  for (const abs of kids(root, "abstractNum")) {
    const id = attr(abs, "abstractNumId");
    if (id !== undefined) abstracts.set(id, levelsOf(abs));
  }

  const out = new Map<string, Map<number, string>>();
  for (const num of kids(root, "num")) {
    const numId = attr(num, "numId");
    if (numId === undefined) continue;
    const levels = new Map(abstracts.get(attr(kid(num, "abstractNumId"), "val") ?? "") ?? []);
    for (const override of kids(num, "lvlOverride")) {
      const lvl = kid(override, "lvl");
      const fmt = attr(kid(lvl, "numFmt"), "val");
      if (fmt) levels.set(Number(attr(override, "ilvl") ?? 0), fmt);
    }
    out.set(numId, levels);
  }
  return out;
}

/** Walks the basedOn chain (bounded against cycles). */
function styleChain(ctx: Ctx, styleId: string | undefined): StyleInfo[] {
  const chain: StyleInfo[] = [];
  let id = styleId;
  while (id && chain.length < 12) {
    const style = ctx.styles.get(id);
    if (!style) break;
    chain.push(style);
    id = style.basedOn;
  }
  return chain;
}

function headingLevel(ctx: Ctx, pPr: XmlElement | undefined, styleId: string | undefined): number {
  const direct = attr(kid(pPr, "outlineLvl"), "val");
  if (direct !== undefined && Number(direct) < 9) return Number(direct) + 1;
  for (const style of styleChain(ctx, styleId)) {
    const named = /^heading\s*([1-9])$/i.exec(style.name);
    if (named) return Number(named[1]);
    if (/^title$/i.test(style.name)) return 1;
    if (/^subtitle$/i.test(style.name)) return 2;
    if (style.outlineLevel !== undefined && style.outlineLevel < 9) return style.outlineLevel + 1;
  }
  return 0;
}

function listPrefix(ctx: Ctx, pPr: XmlElement | undefined, styleId: string | undefined): string {
  const numPr = kid(pPr, "numPr");
  let numId = attr(kid(numPr, "numId"), "val");
  let ilvlRaw = attr(kid(numPr, "ilvl"), "val");
  if (numId === undefined) {
    for (const style of styleChain(ctx, styleId)) {
      if (style.numId !== undefined) {
        numId = style.numId;
        if (ilvlRaw === undefined && style.ilvl !== undefined) ilvlRaw = String(style.ilvl);
        break;
      }
    }
  }
  if (numId === undefined || numId === "0") return "";

  const ilvl = Math.min(Math.max(Number(ilvlRaw ?? 0) || 0, 0), 8);
  const fmt = ctx.numbering.get(numId)?.get(ilvl) ?? "bullet";
  if (fmt === "none") return "";

  const counters = ctx.counters.get(numId) ?? new Array(9).fill(0);
  counters[ilvl]++;
  for (let i = ilvl + 1; i < counters.length; i++) counters[i] = 0;
  ctx.counters.set(numId, counters);

  const indent = "  ".repeat(ilvl);
  return fmt === "bullet" ? `${indent}- ` : `${indent}${counters[ilvl]}. `;
}

function pageBreak(ctx: Ctx, out: string[], rendered: boolean) {
  if (!ctx.pageHasContent) return;
  if (ctx.rendered) {
    ctx.page++;
    out.push("", `=== [PAGE ${ctx.page}] ===`);
    ctx.pageHasContent = false;
  } else if (!rendered) {
    out.push("", "--- [PAGE BREAK] ---", "");
    ctx.pageHasContent = false;
  }
}

/** Label for an inline drawing/picture; text boxes are rendered into `floating`. */
function drawingInline(el: XmlElement, ctx: Ctx, pieces: Piece[], floating: string[]) {
  for (const box of collectAll(el, "txbxcontent")) {
    blocks(box.children, ctx, floating, "nested");
  }
  let label: string | null = null;
  if (findFirst(el, (e) => ln(e) === "chart")) label = "Chart";
  else if (findFirst(el, (e) => ln(e) === "relids")) label = "Diagram";
  else if (findFirst(el, (e) => ln(e) === "blip" || ln(e) === "imagedata")) label = "Image";
  if (!label) return;
  const docPr = findFirst(el, (e) => ln(e) === "docpr");
  const descr = (docPr?.attrs.descr || docPr?.attrs.title || "").replace(/\s+/g, " ").trim();
  pieces.push({ kind: "text", text: descr ? `[${label}: ${descr}]` : `[${label}]`, bold: false, italic: false });
}

/** Outermost descendants with the given local name (does not descend into matches). */
function collectAll(el: XmlElement, local: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of childElements(el)) {
    if (ln(c) === local) out.push(c);
    else collectAll(c, local, out);
  }
  return out;
}

function alternateContent(el: XmlElement): XmlElement | undefined {
  return kid(el, "choice") ?? kid(el, "fallback");
}

function runInline(r: XmlElement, ctx: Ctx, pieces: Piece[], floating: string[], link?: string) {
  const rPr = kid(r, "rPr");
  const hidden = isOn(kid(rPr, "vanish"));
  const bold = isOn(kid(rPr, "b"));
  const italic = isOn(kid(rPr, "i"));
  const text = (t: string) => {
    if (!hidden) pieces.push({ kind: "text", text: t, bold, italic, link });
  };

  for (const c of childElements(r)) {
    switch (ln(c)) {
      case "t":
        text(textContent(c));
        break;
      case "tab":
      case "ptab":
        text("\t");
        break;
      case "br": {
        const type = attr(c, "type");
        if (type === "page") pieces.push({ kind: "break", rendered: false });
        else if (type !== "column") text("\n");
        break;
      }
      case "cr":
        text("\n");
        break;
      case "nobreakhyphen":
        text("-");
        break;
      case "lastrenderedpagebreak":
        pieces.push({ kind: "break", rendered: true });
        break;
      case "footnotereference": {
        const id = attr(c, "id");
        if (id) {
          ctx.footnoteRefs.push(id);
          text(`[^${id}]`);
        }
        break;
      }
      case "endnotereference": {
        const id = attr(c, "id");
        if (id) {
          ctx.endnoteRefs.push(id);
          text(`[^e${id}]`);
        }
        break;
      }
      case "drawing":
      case "pict":
      case "object":
        if (!hidden) drawingInline(c, ctx, pieces, floating);
        break;
      case "alternatecontent": {
        const chosen = alternateContent(c);
        if (chosen) runInline(chosen, ctx, pieces, floating, link);
        break;
      }
      // instrText, delText, fldChar, rPr, footnoteRef, sym, softHyphen...: no visible text
    }
  }
}

function collectInline(nodes: XmlElement["children"], ctx: Ctx, pieces: Piece[], floating: string[], link?: string) {
  for (const el of nodes) {
    if (typeof el === "string") continue;
    switch (ln(el)) {
      case "r":
        runInline(el, ctx, pieces, floating, link);
        break;
      case "hyperlink": {
        const rel = ctx.rels.get(attr(el, "id") ?? "");
        collectInline(el.children, ctx, pieces, floating, rel?.external ? rel.target : link);
        break;
      }
      case "sdt":
        collectInline(kid(el, "sdtContent")?.children ?? [], ctx, pieces, floating, link);
        break;
      case "alternatecontent": {
        const chosen = alternateContent(el);
        if (chosen) collectInline(chosen.children, ctx, pieces, floating, link);
        break;
      }
      case "ins":
      case "moveto":
      case "smarttag":
      case "customxml":
      case "fldsimple":
      case "bdo":
      case "dir":
        collectInline(el.children, ctx, pieces, floating, link);
        break;
      // del, moveFrom, proofErr, bookmarks, comments: skipped
    }
  }
}

function wrapFormatting(text: string, bold: boolean, italic: boolean, link: string | undefined, plain: boolean): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!m || !m[2]) return text;
  let core = m[2];
  if (link) core = `[${core}](${link})`;
  const mark = plain ? "" : bold && italic ? "***" : bold ? "**" : italic ? "*" : "";
  if (mark && !core.includes("\n")) core = `${mark}${core}${mark}`;
  return `${m[1]}${core}${m[3]}`;
}

/** Splits pieces at page breaks into formatted text segments. */
function segmentsOf(pieces: Piece[], plain: boolean): { text: string; breakAfter: boolean | null }[] {
  const segments: { text: string; breakAfter: boolean | null }[] = [];
  let groups: Extract<Piece, { kind: "text" }>[] = [];

  const flush = (breakAfter: boolean | null) => {
    const text = groups.map((g) => wrapFormatting(g.text, g.bold, g.italic, g.link, plain)).join("");
    segments.push({ text, breakAfter });
    groups = [];
  };

  for (const piece of pieces) {
    if (piece.kind === "break") {
      flush(piece.rendered);
      continue;
    }
    const last = groups[groups.length - 1];
    if (last && last.bold === piece.bold && last.italic === piece.italic && last.link === piece.link) {
      last.text += piece.text;
    } else {
      groups.push({ ...piece });
    }
  }
  flush(null);
  return segments;
}

function paragraph(p: XmlElement, ctx: Ctx, out: string[], mode: Mode) {
  const track = mode === "body";
  const pPr = kid(p, "pPr");
  const styleId = attr(kid(pPr, "pStyle"), "val");

  if (track) {
    const direct = kid(pPr, "pageBreakBefore");
    const fromStyle = styleChain(ctx, styleId).find((s) => s.pageBreakBefore !== undefined)?.pageBreakBefore;
    if (direct ? isOn(direct) : fromStyle) pageBreak(ctx, out, false);
  }

  const pieces: Piece[] = [];
  const floating: string[] = [];
  collectInline(p.children, ctx, pieces, floating);

  const level = headingLevel(ctx, pPr, styleId);
  const hasText = pieces.some((piece) => piece.kind === "text" && piece.text.trim());
  const prefix = level ? `${"#".repeat(level)} ` : hasText ? listPrefix(ctx, pPr, styleId) : "";

  const segments = segmentsOf(pieces, level > 0);
  let prefixed = false;
  for (const seg of segments) {
    const text = level ? seg.text.replace(/\s*\n\s*/g, " ") : seg.text;
    if (text.trim()) {
      out.push(prefixed ? text : `${prefix}${text}`);
      prefixed = true;
      if (track) ctx.pageHasContent = true;
    } else if (segments.length === 1) {
      out.push("");
    }
    if (seg.breakAfter !== null && track) pageBreak(ctx, out, seg.breakAfter);
  }

  if (floating.some((line) => line.trim())) {
    out.push(...floating);
    if (track) ctx.pageHasContent = true;
  }

  // Section break carried by this paragraph (default type is nextPage)
  const sectType = attr(kid(kid(pPr, "sectPr"), "type"), "val") ?? (kid(pPr, "sectPr") ? "nextPage" : null);
  if (track && sectType && sectType !== "continuous" && sectType !== "nextColumn") pageBreak(ctx, out, false);
}

function rowCells(tr: XmlElement): XmlElement[] {
  const cells: XmlElement[] = [];
  for (const c of childElements(tr)) {
    const name = ln(c);
    if (name === "tc") cells.push(c);
    else if (name === "sdt") cells.push(...rowCells(kid(c, "sdtContent") ?? c));
    else if (name === "customxml") cells.push(...rowCells(c));
  }
  return cells;
}

function tableRows(tbl: XmlElement): XmlElement[] {
  const rows: XmlElement[] = [];
  for (const c of childElements(tbl)) {
    const name = ln(c);
    if (name === "tr") rows.push(c);
    else if (name === "sdt") rows.push(...tableRows(kid(c, "sdtContent") ?? c));
    else if (name === "customxml") rows.push(...tableRows(c));
  }
  return rows;
}

function table(tbl: XmlElement, ctx: Ctx, out: string[], mode: Mode) {
  const track = mode === "body";
  const lines: string[] = [];
  let width = 0;

  for (const tr of tableRows(tbl)) {
    // Word marks a page boundary in every cell of the row; count it once, before the row
    if (track) {
      const breaks = findFirst(
        tr,
        (e) => ln(e) === "lastrenderedpagebreak" || (ln(e) === "br" && attr(e, "type") === "page")
      );
      if (breaks) {
        if (lines.length) {
          out.push("", ...lines);
          lines.length = 0;
          width = 0;
        }
        pageBreak(ctx, out, ln(breaks) === "lastrenderedpagebreak");
      }
    }

    const cells: string[] = [];
    for (const tc of rowCells(tr)) {
      const tcPr = kid(tc, "tcPr");
      const span = Math.max(Number(attr(kid(tcPr, "gridSpan"), "val")) || 1, 1);
      const vMerge = kid(tcPr, "vMerge");
      let text = "";
      if (!vMerge || attr(vMerge, "val") === "restart") {
        const sub: string[] = [];
        blocks(tc.children, ctx, sub, "nested");
        text = sub
          .map((line) => line.trim())
          .filter(Boolean)
          .join(mode === "body" ? "<br>" : " ")
          .replace(/\|/g, "\\|");
      }
      cells.push(text, ...new Array(span - 1).fill(""));
    }
    if (!cells.length) continue;

    if (mode === "nested") {
      const joined = cells.filter(Boolean).join(" ; ");
      if (joined) lines.push(joined);
      continue;
    }
    lines.push(`| ${cells.join(" | ")} |`);
    if (width === 0) {
      width = cells.length;
      lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
    }
    if (cells.some(Boolean)) ctx.pageHasContent = true;
  }

  if (lines.length) out.push("", ...lines, "");
}

function blocks(nodes: XmlElement["children"], ctx: Ctx, out: string[], mode: Mode) {
  for (const el of nodes) {
    if (typeof el === "string") continue;
    switch (ln(el)) {
      case "p":
        paragraph(el, ctx, out, mode);
        break;
      case "tbl":
        table(el, ctx, out, mode);
        break;
      case "sdt":
        blocks(kid(el, "sdtContent")?.children ?? [], ctx, out, mode);
        break;
      case "alternatecontent": {
        const chosen = alternateContent(el);
        if (chosen) blocks(chosen.children, ctx, out, mode);
        break;
      }
      case "customxml":
      case "ins":
      case "moveto":
        blocks(el.children, ctx, out, mode);
        break;
      // sectPr, bookmarks, del, moveFrom: skipped
    }
  }
}

function tidy(lines: string[]): string {
  return lines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function headerFooterText(zip: ZipArchive, ctx: Ctx, body: XmlElement, local: string): Promise<string> {
  const parts: string[] = [];
  for (const sectPr of [...collectAll(body, "sectpr")]) {
    for (const ref of kids(sectPr, local)) {
      const rel = ctx.rels.get(attr(ref, "id") ?? "");
      if (rel && !rel.external && !parts.includes(rel.target)) parts.push(rel.target);
    }
  }

  const texts: string[] = [];
  for (const partPath of parts) {
    const root = (await readZipXml(zip, partPath))?.children.find(
      (c): c is XmlElement => typeof c !== "string" && (ln(c) === "hdr" || ln(c) === "ftr")
    );
    if (!root) continue;
    const partCtx: Ctx = { ...ctx, rels: await readRels(zip, partPath), counters: new Map() };
    const lines: string[] = [];
    blocks(root.children, partCtx, lines, "nested");
    const text = tidy(lines);
    if (text && !texts.includes(text)) texts.push(text);
  }
  return texts.join("\n\n");
}

async function notesText(
  zip: ZipArchive,
  ctx: Ctx,
  partPath: string | undefined,
  local: "footnote" | "endnote",
  refs: string[],
  marker: string
): Promise<string> {
  if (!partPath || refs.length === 0) return "";
  const root = rootOf(await readZipXml(zip, partPath), `${local}s`);
  const byId = new Map<string, XmlElement>();
  for (const note of kids(root, local)) {
    const type = attr(note, "type");
    if (type && type !== "normal") continue;
    const id = attr(note, "id");
    if (id) byId.set(id, note);
  }

  const partCtx: Ctx = { ...ctx, rels: await readRels(zip, partPath), footnoteRefs: [], endnoteRefs: [] };
  const lines: string[] = [];
  for (const id of new Set(refs)) {
    const note = byId.get(id);
    if (!note) continue;
    const sub: string[] = [];
    blocks(note.children, partCtx, sub, "nested");
    const text = sub.map((l) => l.trim()).filter(Boolean).join(" ");
    if (text) lines.push(`[^${marker}${id}]: ${text}`);
  }
  return lines.join("\n");
}

async function mainDocumentPath(zip: ZipArchive): Promise<string> {
  const root = rootOf(await readZipXml(zip, "_rels/.rels"), "relationships");
  const rel = kids(root, "relationship").find((r) => /\/officeDocument$/.test(r.attrs.Type ?? ""));
  return rel?.attrs.Target ? resolveZipPath("", rel.attrs.Target) : "word/document.xml";
}

export async function parseDocxText(input: Uint8Array | ArrayBuffer): Promise<DocxTextResult> {
  let zip: ZipArchive;
  try {
    zip = await loadZip(input);
  } catch {
    throw new Error("Not a valid Word document (.docx).");
  }

  const docPath = await mainDocumentPath(zip);
  const raw = await readZipText(zip, docPath);
  if (raw === null) throw new Error(`${docPath} not found: not a valid DOCX document.`);
  const body = kid(rootOf(parseXml(raw), "document"), "body");
  if (!body) throw new Error("DOCX document body not found.");

  const rels = await readRels(zip, docPath);
  const partOf = (type: string) =>
    [...rels.values()].find((r) => !r.external && r.target.toLowerCase().endsWith(`/${type}.xml`))?.target;

  const ctx: Ctx = {
    styles: parseStyles(await readZipXml(zip, partOf("styles") ?? "word/styles.xml")),
    numbering: parseNumbering(await readZipXml(zip, partOf("numbering") ?? "word/numbering.xml")),
    rels,
    rendered: raw.includes("lastRenderedPageBreak"),
    page: 1,
    pageHasContent: false,
    counters: new Map(),
    footnoteRefs: [],
    endnoteRefs: [],
  };

  const lines: string[] = ctx.rendered ? ["=== [PAGE 1] ==="] : [];
  blocks(body.children, ctx, lines, "body");

  const sections: string[] = [];
  const header = await headerFooterText(zip, ctx, body, "headerreference");
  if (header) sections.push(`[Header]\n${header}`);
  sections.push(tidy(lines));
  const footer = await headerFooterText(zip, ctx, body, "footerreference");
  if (footer) sections.push(`[Footer]\n${footer}`);
  const footnotes = await notesText(zip, ctx, partOf("footnotes"), "footnote", ctx.footnoteRefs, "");
  if (footnotes) sections.push(`[Footnotes]\n${footnotes}`);
  const endnotes = await notesText(zip, ctx, partOf("endnotes"), "endnote", ctx.endnoteRefs, "e");
  if (endnotes) sections.push(`[Endnotes]\n${endnotes}`);

  return {
    text: sections.filter(Boolean).join("\n\n"),
    pageCount: ctx.rendered ? ctx.page : null,
  };
}
