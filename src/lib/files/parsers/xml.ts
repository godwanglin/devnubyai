/**
 * Minimal, dependency-free XML tree parser shared by the document parsers.
 *
 * Isomorphic (no DOMParser), so the same code powers the side-panel previews in the
 * browser and the text extractors on the server. Lenient by design: mismatched closing
 * tags pop to the nearest matching ancestor and HTML void elements are self-closed, so
 * slightly malformed XHTML (common in EPUBs) still yields a usable tree.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

export type XmlNode = XmlElement | string;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  shy: "­",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  laquo: "«",
  raquo: "»",
  middot: "·",
};

const HTML_VOID_ELEMENTS = new Set([
  "br", "img", "hr", "meta", "link", "input", "col", "area", "base", "wbr", "source", "embed", "param", "track",
]);

export function decodeXmlEntities(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function findTagEnd(src: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    }
  }
  return src.length;
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    attrs[m[1]] = decodeXmlEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

export function parseXml(src: string): XmlElement {
  const root: XmlElement = { name: "#document", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  const n = src.length;
  let i = 0;

  const top = () => stack[stack.length - 1];
  const pushText = (text: string) => {
    if (text) top().children.push(decodeXmlEntities(text));
  };

  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt === -1) {
      pushText(src.slice(i));
      break;
    }
    if (lt > i) pushText(src.slice(i, lt));

    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      const text = src.slice(lt + 9, end === -1 ? n : end);
      if (text) top().children.push(text);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (src[lt + 1] === "?") {
      const end = src.indexOf("?>", lt + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (src[lt + 1] === "!") {
      // DOCTYPE (possibly with an internal [subset])
      let j = lt + 2;
      let depth = 0;
      while (j < n) {
        const c = src[j];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
        j++;
      }
      i = j + 1;
      continue;
    }

    const gt = findTagEnd(src, lt + 1);
    const inner = src.slice(lt + 1, gt);
    i = gt + 1;

    if (inner[0] === "/") {
      const name = inner.slice(1).trim();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }

    const selfClosing = inner.endsWith("/");
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const nameMatch = /^([^\s/>]+)/.exec(body);
    if (!nameMatch) continue;

    const name = nameMatch[1];
    const el: XmlElement = {
      name,
      attrs: parseAttributes(body.slice(name.length)),
      children: [],
    };
    top().children.push(el);
    if (!selfClosing && !HTML_VOID_ELEMENTS.has(name.toLowerCase())) stack.push(el);
  }

  return root;
}

export function isElement(node: XmlNode | undefined): node is XmlElement {
  return typeof node === "object" && node !== null;
}

/** Strips a namespace prefix: "a:t" -> "t", "body" -> "body". */
export function localName(name: string): string {
  const idx = name.indexOf(":");
  return (idx === -1 ? name : name.slice(idx + 1)).toLowerCase();
}

/** Direct child elements with the given qualified name. */
export function childElements(el: XmlElement | undefined, name?: string): XmlElement[] {
  if (!el) return [];
  const out: XmlElement[] = [];
  for (const child of el.children) {
    if (isElement(child) && (!name || child.name === name)) out.push(child);
  }
  return out;
}

export function child(el: XmlElement | undefined, name: string): XmlElement | undefined {
  if (!el) return undefined;
  for (const c of el.children) {
    if (isElement(c) && c.name === name) return c;
  }
  return undefined;
}

/** Follows a path of direct child names: path(el, "p:cSld", "p:spTree"). */
export function path(el: XmlElement | undefined, ...names: string[]): XmlElement | undefined {
  let cur = el;
  for (const name of names) {
    cur = child(cur, name);
    if (!cur) return undefined;
  }
  return cur;
}

/** Depth-first search for the first descendant matching the predicate. */
export function findFirst(
  el: XmlElement | undefined,
  match: (el: XmlElement) => boolean
): XmlElement | undefined {
  if (!el) return undefined;
  for (const c of el.children) {
    if (!isElement(c)) continue;
    if (match(c)) return c;
    const deep = findFirst(c, match);
    if (deep) return deep;
  }
  return undefined;
}

export function findAll(
  el: XmlElement | undefined,
  match: (el: XmlElement) => boolean,
  out: XmlElement[] = []
): XmlElement[] {
  if (!el) return out;
  for (const c of el.children) {
    if (!isElement(c)) continue;
    if (match(c)) out.push(c);
    findAll(c, match, out);
  }
  return out;
}

export function textContent(el: XmlElement | undefined): string {
  if (!el) return "";
  let out = "";
  for (const c of el.children) {
    out += typeof c === "string" ? c : textContent(c);
  }
  return out;
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Resolves a relative zip-part reference against the part that references it. */
export function resolveZipPath(fromPart: string, target: string): string {
  const clean = target.split("#")[0].split("?")[0];
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    // keep raw
  }
  if (decoded.startsWith("/")) return decoded.slice(1);
  const baseParts = fromPart.split("/").slice(0, -1);
  for (const seg of decoded.split("/")) {
    if (seg === "..") baseParts.pop();
    else if (seg && seg !== ".") baseParts.push(seg);
  }
  return baseParts.join("/");
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

/** Image MIME the browser can render for a zip part path, or null (EMF/WMF/TIFF...). */
export function renderableImageMime(partPath: string): string | null {
  const ext = partPath.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_MIME_BY_EXT[ext] ?? null;
}
