import {
  childElements,
  escapeHtml,
  findAll,
  findFirst,
  isElement,
  localName,
  parseXml,
  renderableImageMime,
  resolveZipPath,
  textContent,
  type XmlElement,
  type XmlNode,
} from "./xml";
import { loadZip, readZipBase64, readZipText, readZipXml, zipEntrySize, type ZipArchive } from "./zip";

/**
 * EPUB (2 & 3) reader: resolves the package (OPF), reading order (spine) and
 * table of contents (nav.xhtml or NCX), and renders chapters to safe HTML/text.
 */

export interface EpubChapterRef {
  path: string;
  title: string;
}

export interface EpubBook {
  title: string;
  author: string;
  chapters: EpubChapterRef[];
  zip: ZipArchive;
}

/** Prefix for internal links; the viewer intercepts these to switch chapters. */
export const EPUB_LINK_PREFIX = "#epub:";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ALLOWED_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "thead", "tbody", "tfoot",
  "tr", "th", "td", "caption", "strong", "b", "em", "i", "u", "s", "sub", "sup", "blockquote", "pre",
  "code", "br", "hr", "a", "img", "span", "div", "section", "article", "figure", "figcaption", "aside",
  "header", "footer", "small", "mark", "abbr", "cite", "q", "dl", "dt", "dd",
]);

const DROP_TAGS = new Set([
  "script", "style", "head", "title", "meta", "link", "iframe", "object", "embed", "form", "input",
  "button", "select", "textarea", "audio", "video", "source", "track", "canvas", "noscript", "template",
]);

const BLOCK_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "div", "section", "article", "blockquote",
  "pre", "figure", "figcaption", "dt", "dd", "header", "footer", "aside", "br", "hr", "table", "caption",
]);

function attr(el: XmlElement, name: string): string | undefined {
  if (el.attrs[name] !== undefined) return el.attrs[name];
  const lower = name.toLowerCase();
  const key = Object.keys(el.attrs).find((k) => localName(k) === lower);
  return key ? el.attrs[key] : undefined;
}

function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export async function openEpub(input: Uint8Array | ArrayBuffer): Promise<EpubBook> {
  const zip = await loadZip(input);

  const container = await readZipXml(zip, "META-INF/container.xml");
  const rootfile = findFirst(container ?? undefined, (el) => localName(el.name) === "rootfile");
  const opfPath = rootfile ? attr(rootfile, "full-path") : undefined;
  if (!opfPath) throw new Error("Not a valid EPUB file (container.xml not found).");

  const opf = await readZipXml(zip, opfPath);
  const pkg = findFirst(opf ?? undefined, (el) => localName(el.name) === "package");
  if (!pkg) throw new Error("Unable to read the EPUB OPF package.");

  const metadata = childElements(pkg).find((el) => localName(el.name) === "metadata");
  const manifest = childElements(pkg).find((el) => localName(el.name) === "manifest");
  const spine = childElements(pkg).find((el) => localName(el.name) === "spine");

  const metaText = (name: string) =>
    cleanTitle(textContent(childElements(metadata).find((el) => localName(el.name) === name)));

  const items = new Map<string, { path: string; mediaType: string; properties: string }>();
  for (const item of childElements(manifest)) {
    if (localName(item.name) !== "item") continue;
    const id = attr(item, "id");
    const href = attr(item, "href");
    if (!id || !href) continue;
    items.set(id, {
      path: resolveZipPath(opfPath, href),
      mediaType: attr(item, "media-type") ?? "",
      properties: attr(item, "properties") ?? "",
    });
  }

  // Table of contents titles keyed by chapter path (first entry wins)
  const titles = new Map<string, string>();
  const navItem = [...items.values()].find((it) => it.properties.split(/\s+/).includes("nav"));
  if (navItem) {
    const nav = await readZipXml(zip, navItem.path);
    const navs = findAll(nav ?? undefined, (el) => localName(el.name) === "nav");
    const tocNav = navs.find((el) => (attr(el, "type") ?? "").includes("toc")) ?? navs[0];
    for (const a of findAll(tocNav, (el) => localName(el.name) === "a")) {
      const href = attr(a, "href");
      const title = cleanTitle(textContent(a));
      if (!href || !title) continue;
      const target = resolveZipPath(navItem.path, href);
      if (!titles.has(target)) titles.set(target, title);
    }
  }
  if (titles.size === 0) {
    const tocId = spine ? attr(spine, "toc") : undefined;
    const ncxItem =
      (tocId ? items.get(tocId) : undefined) ??
      [...items.values()].find((it) => it.mediaType === "application/x-dtbncx+xml");
    if (ncxItem) {
      const ncx = await readZipXml(zip, ncxItem.path);
      for (const point of findAll(ncx ?? undefined, (el) => localName(el.name) === "navpoint")) {
        const label = findFirst(point, (el) => localName(el.name) === "text");
        const content = childElements(point).find((el) => localName(el.name) === "content");
        const src = content ? attr(content, "src") : undefined;
        const title = cleanTitle(textContent(label));
        if (!src || !title) continue;
        const target = resolveZipPath(ncxItem.path, src);
        if (!titles.has(target)) titles.set(target, title);
      }
    }
  }

  const chapters: EpubChapterRef[] = [];
  for (const ref of childElements(spine)) {
    if (localName(ref.name) !== "itemref") continue;
    const item = items.get(attr(ref, "idref") ?? "");
    if (!item) continue;
    if (!/html|xml/i.test(item.mediaType) && !/\.x?html?$/i.test(item.path)) continue;
    chapters.push({ path: item.path, title: titles.get(item.path) ?? "" });
  }
  if (chapters.length === 0) throw new Error("EPUB has no readable chapters.");

  return {
    title: metaText("title"),
    author: metaText("creator"),
    chapters,
    zip,
  };
}

interface RenderContext {
  chapterPath: string;
  images: Map<string, string>;
}

function serialize(nodes: XmlNode[], ctx: RenderContext): string {
  let out = "";
  for (const node of nodes) {
    if (!isElement(node)) {
      out += escapeHtml(node);
      continue;
    }
    const tag = localName(node.name);
    if (DROP_TAGS.has(tag)) continue;

    if (tag === "svg") {
      // Cover pages often wrap a single <image xlink:href> in SVG
      for (const image of findAll(node, (el) => localName(el.name) === "image")) {
        const href = attr(image, "href");
        const src = href ? ctx.images.get(resolveZipPath(ctx.chapterPath, href)) : undefined;
        if (src) out += `<img src="${src}" alt="">`;
      }
      continue;
    }
    if (tag === "math") {
      out += `<code>${escapeHtml(cleanTitle(textContent(node)))}</code>`;
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      out += serialize(node.children, ctx);
      continue;
    }

    if (tag === "img") {
      const srcAttr = attr(node, "src");
      const src = srcAttr ? ctx.images.get(resolveZipPath(ctx.chapterPath, srcAttr)) : undefined;
      if (src) out += `<img src="${src}" alt="${escapeHtml(attr(node, "alt") ?? "")}">`;
      continue;
    }
    if (tag === "br" || tag === "hr") {
      out += `<${tag}>`;
      continue;
    }

    let attrs = "";
    if (tag === "a") {
      const href = (attr(node, "href") ?? "").trim();
      if (/^(https?:|mailto:)/i.test(href)) {
        attrs = ` href="${escapeHtml(href)}"`;
      } else if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        const target = href.startsWith("#") ? ctx.chapterPath : resolveZipPath(ctx.chapterPath, href);
        attrs = ` href="${EPUB_LINK_PREFIX}${encodeURIComponent(target)}"`;
      }
    } else if (tag === "td" || tag === "th") {
      const colspan = attr(node, "colspan");
      const rowspan = attr(node, "rowspan");
      if (colspan && /^\d+$/.test(colspan)) attrs += ` colspan="${colspan}"`;
      if (rowspan && /^\d+$/.test(rowspan)) attrs += ` rowspan="${rowspan}"`;
    }

    out += `<${tag}${attrs}>${serialize(node.children, ctx)}</${tag}>`;
  }
  return out;
}

function plainText(nodes: XmlNode[], parts: string[]) {
  for (const node of nodes) {
    if (!isElement(node)) {
      parts.push(node.replace(/\s+/g, " "));
      continue;
    }
    const tag = localName(node.name);
    if (DROP_TAGS.has(tag)) continue;
    const block = BLOCK_TAGS.has(tag);
    if (block) parts.push("\n");
    if (tag === "li") parts.push("- ");
    plainText(node.children, parts);
    if (tag === "td" || tag === "th") parts.push(" | ");
    if (block) parts.push("\n");
  }
}

export interface EpubChapterContent {
  html: string;
  text: string;
  /** First heading in the chapter, used when the TOC has no entry for it */
  heading: string;
}

export async function renderEpubChapter(
  book: EpubBook,
  chapterPath: string,
  options: { withImages?: boolean } = {}
): Promise<EpubChapterContent> {
  const raw = await readZipText(book.zip, chapterPath);
  if (raw === null) throw new Error(`Chapter '${chapterPath}' not found in the EPUB.`);

  const doc = parseXml(raw);
  const body = findFirst(doc, (el) => localName(el.name) === "body") ?? doc;

  const images = new Map<string, string>();
  if (options.withImages) {
    const refs = new Set<string>();
    for (const el of findAll(body, (e) => ["img", "image"].includes(localName(e.name)))) {
      const ref = attr(el, "src") ?? attr(el, "href");
      if (ref && !/^[a-z][a-z0-9+.-]*:/i.test(ref)) refs.add(resolveZipPath(chapterPath, ref));
    }
    for (const ref of refs) {
      const mime = renderableImageMime(ref);
      if (!mime || mime === "image/svg+xml" || mime === "image/bmp") continue;
      if (zipEntrySize(book.zip, ref) > MAX_IMAGE_BYTES) continue;
      const b64 = await readZipBase64(book.zip, ref);
      if (b64) images.set(ref, `data:${mime};base64,${b64}`);
    }
  }

  const parts: string[] = [];
  plainText(body.children, parts);
  const text = parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const headingEl = findFirst(body, (el) => /^h[1-3]$/.test(localName(el.name)));

  return {
    html: serialize(body.children, { chapterPath, images }),
    text,
    heading: cleanTitle(textContent(headingEl)),
  };
}
