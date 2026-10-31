/**
 * Strict allowlist sanitizer for document HTML (Mammoth DOCX output, converted
 * DOC/RTF/ODT, EPUB chapters) so it can be rendered directly in the DOM with zero
 * script/XSS surface and native text selection.
 */

const ALLOWED_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "thead", "tbody", "tfoot",
  "tr", "th", "td", "caption", "strong", "b", "em", "i", "u", "s", "sub", "sup", "blockquote", "pre",
  "code", "br", "hr", "a", "img", "span", "div", "section", "article", "figure", "figcaption", "aside",
  "header", "footer", "small", "mark", "abbr", "cite", "q", "dl", "dt", "dd",
]);

const DROP_TAGS = new Set(["script", "style", "iframe", "object", "embed", "form", "link", "meta", "svg", "math"]);

export function isSafeUrl(raw: string, allowDataImage: boolean): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (allowDataImage && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(trimmed)) {
    return true;
  }
  try {
    const parsed = new URL(trimmed, "https://example.invalid");
    return parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

export function sanitizeDocumentHtml(rawHtml: string): string {
  if (typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");

  function cleanNode(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || "");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP_TAGS.has(tag)) return null;

    const outTag = ALLOWED_TAGS.has(tag) ? tag : "span";
    const cleanEl = document.createElement(outTag);

    if (outTag === "a") {
      const href = el.getAttribute("href") || "";
      if (isSafeUrl(href, false)) {
        cleanEl.setAttribute("href", href);
        cleanEl.setAttribute("target", "_blank");
        cleanEl.setAttribute("rel", "noopener noreferrer");
      }
    } else if (outTag === "img") {
      const src = el.getAttribute("src") || "";
      if (!isSafeUrl(src, true)) return null;
      cleanEl.setAttribute("src", src);
      const alt = el.getAttribute("alt");
      if (alt) cleanEl.setAttribute("alt", alt);
    } else if (outTag === "td" || outTag === "th") {
      const colspan = el.getAttribute("colspan");
      const rowspan = el.getAttribute("rowspan");
      if (colspan && /^\d+$/.test(colspan)) cleanEl.setAttribute("colspan", colspan);
      if (rowspan && /^\d+$/.test(rowspan)) cleanEl.setAttribute("rowspan", rowspan);
    }

    for (const child of Array.from(el.childNodes)) {
      const cleaned = cleanNode(child);
      if (cleaned) cleanEl.appendChild(cleaned);
    }
    return cleanEl;
  }

  const wrapper = document.createElement("div");
  for (const child of Array.from(doc.body.childNodes)) {
    const cleaned = cleanNode(child);
    if (cleaned) wrapper.appendChild(cleaned);
  }
  return wrapper.innerHTML;
}

/** Shared typography for rendered documents in the side panel. */
export const DOCUMENT_PROSE_CLASS =
  "prose-chat max-w-[740px] mx-auto text-[14.5px] leading-relaxed text-[var(--ink)] [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-[var(--border)] [&_th]:bg-[var(--surface)] [&_th]:px-3 [&_th]:py-2 [&_td]:border [&_td]:border-[var(--border)] [&_td]:px-3 [&_td]:py-2 [&_td_p]:my-0 [&_img]:rounded-[8px] [&_img]:max-w-full [&_img]:h-auto";
