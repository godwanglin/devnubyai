import {
  child,
  childElements,
  escapeHtml,
  isElement,
  path,
  renderableImageMime,
  type XmlElement,
} from "./xml";
import { loadZip, readZipBase64, readZipXml, zipEntrySize } from "./zip";

/**
 * OpenDocument Text (.odt) → safe HTML (preview) and plain text (AI).
 * Covers headings, paragraphs, bold/italic/underline spans, links, lists,
 * tables and embedded raster images.
 */

interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  parent?: string;
}

interface OdtContext {
  styles: Map<string, TextStyle>;
  orderedLists: Set<string>;
  images: Map<string, string>;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REPEAT = 20;

function collectStyles(root: XmlElement | null, ctx: OdtContext) {
  if (!root) return;
  const containers = [
    path(root, "office:document-content", "office:automatic-styles"),
    path(root, "office:document-styles", "office:styles"),
    path(root, "office:document-styles", "office:automatic-styles"),
  ];
  for (const container of containers) {
    for (const el of childElements(container)) {
      const name = el.attrs["style:name"];
      if (!name) continue;
      if (el.name === "style:style") {
        const props = child(el, "style:text-properties");
        const style: TextStyle = { parent: el.attrs["style:parent-style-name"] };
        if (props) {
          const weight = props.attrs["fo:font-weight"];
          if (weight) style.bold = weight === "bold" || Number(weight) >= 600;
          const fontStyle = props.attrs["fo:font-style"];
          if (fontStyle) style.italic = fontStyle === "italic" || fontStyle === "oblique";
          const underline = props.attrs["style:text-underline-style"];
          if (underline) style.underline = underline !== "none";
        }
        ctx.styles.set(name, style);
      } else if (el.name === "text:list-style") {
        const firstLevel = childElements(el)[0];
        if (firstLevel?.name === "text:list-level-style-number") ctx.orderedLists.add(name);
      }
    }
  }
}

function resolveStyle(ctx: OdtContext, name: string | undefined): TextStyle {
  const result: TextStyle = {};
  let cur = name;
  for (let depth = 0; cur && depth < 10; depth++) {
    const style = ctx.styles.get(cur);
    if (!style) break;
    result.bold ??= style.bold;
    result.italic ??= style.italic;
    result.underline ??= style.underline;
    cur = style.parent;
  }
  return result;
}

function wrapStyled(html: string, style: TextStyle): string {
  if (!html) return html;
  let out = html;
  if (style.underline) out = `<u>${out}</u>`;
  if (style.italic) out = `<em>${out}</em>`;
  if (style.bold) out = `<strong>${out}</strong>`;
  return out;
}

function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href.trim());
}

function inlineHtml(nodes: XmlElement["children"], ctx: OdtContext): string {
  let out = "";
  for (const node of nodes) {
    if (!isElement(node)) {
      out += escapeHtml(node.replace(/\s+/g, " "));
      continue;
    }
    switch (node.name) {
      case "text:span":
        out += wrapStyled(inlineHtml(node.children, ctx), resolveStyle(ctx, node.attrs["text:style-name"]));
        break;
      case "text:a": {
        const href = node.attrs["xlink:href"] ?? "";
        const inner = inlineHtml(node.children, ctx);
        out += isSafeHref(href) ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
        break;
      }
      case "text:s": {
        const count = Math.min(Number(node.attrs["text:c"] ?? 1) || 1, 50);
        out += "&nbsp;".repeat(count);
        break;
      }
      case "text:tab":
        out += "&emsp;";
        break;
      case "text:line-break":
        out += "<br>";
        break;
      case "text:note": {
        const citation = path(node, "text:note-citation");
        if (citation) out += `<sup>${escapeHtml(inlineText(citation.children))}</sup>`;
        break;
      }
      case "draw:frame":
        out += frameHtml(node, ctx);
        break;
      case "office:annotation":
      case "text:bookmark":
      case "text:bookmark-start":
      case "text:bookmark-end":
      case "text:soft-page-break":
        break;
      default:
        out += inlineHtml(node.children, ctx);
    }
  }
  return out;
}

function inlineText(nodes: XmlElement["children"]): string {
  let out = "";
  for (const node of nodes) {
    if (!isElement(node)) {
      out += node.replace(/\s+/g, " ");
      continue;
    }
    switch (node.name) {
      case "text:s":
        out += " ".repeat(Math.min(Number(node.attrs["text:c"] ?? 1) || 1, 50));
        break;
      case "text:tab":
        out += "\t";
        break;
      case "text:line-break":
        out += "\n";
        break;
      case "text:note":
      case "office:annotation":
        break;
      default:
        out += inlineText(node.children);
    }
  }
  return out;
}

function frameHtml(frame: XmlElement, ctx: OdtContext): string {
  let out = "";
  for (const el of childElements(frame)) {
    if (el.name === "draw:image") {
      const href = el.attrs["xlink:href"] ?? "";
      const dataUrl = ctx.images.get(href);
      if (dataUrl) out += `<img src="${dataUrl}" alt="">`;
    } else if (el.name === "draw:text-box") {
      out += blocksHtml(el.children, ctx);
    }
  }
  return out;
}

function tableHtml(table: XmlElement, ctx: OdtContext): string {
  const rows: XmlElement[] = [];
  const collectRows = (el: XmlElement) => {
    for (const c of childElements(el)) {
      if (c.name === "table:table-row") {
        const repeat = Math.min(Number(c.attrs["table:number-rows-repeated"] ?? 1) || 1, MAX_REPEAT);
        for (let k = 0; k < repeat; k++) rows.push(c);
      } else if (
        c.name === "table:table-header-rows" ||
        c.name === "table:table-rows" ||
        c.name === "table:table-row-group"
      ) {
        collectRows(c);
      }
    }
  };
  collectRows(table);

  const body = rows
    .map((row) => {
      const cells = childElements(row)
        .filter((c) => c.name === "table:table-cell")
        .map((cell) => {
          const repeat = Math.min(Number(cell.attrs["table:number-columns-repeated"] ?? 1) || 1, MAX_REPEAT);
          const colspan = Number(cell.attrs["table:number-columns-spanned"] ?? 1);
          const rowspan = Number(cell.attrs["table:number-rows-spanned"] ?? 1);
          const attrs =
            (colspan > 1 ? ` colspan="${colspan}"` : "") + (rowspan > 1 ? ` rowspan="${rowspan}"` : "");
          return `<td${attrs}>${blocksHtml(cell.children, ctx)}</td>`.repeat(repeat);
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    // Drop trailing rows that are entirely empty (spreadsheet-style padding)
    .filter((html) => html.replace(/<[^>]+>/g, "").trim() !== "" || html.includes("<img"));

  return body.length ? `<table><tbody>${body.join("")}</tbody></table>` : "";
}

function listHtml(list: XmlElement, ctx: OdtContext, inheritedStyle?: string): string {
  const styleName = list.attrs["text:style-name"] ?? inheritedStyle;
  const tag = styleName && ctx.orderedLists.has(styleName) ? "ol" : "ul";
  const items = childElements(list)
    .filter((c) => c.name === "text:list-item" || c.name === "text:list-header")
    .map((item) => {
      const inner = childElements(item)
        .map((c) => {
          if (c.name === "text:list") return listHtml(c, ctx, styleName);
          if (c.name === "text:p" || c.name === "text:h") {
            return wrapStyled(inlineHtml(c.children, ctx), resolveStyle(ctx, c.attrs["text:style-name"]));
          }
          return blocksHtml([c], ctx);
        })
        .join("<br>");
      return `<li>${inner}</li>`;
    })
    .join("");
  return `<${tag}>${items}</${tag}>`;
}

function blocksHtml(nodes: XmlElement["children"], ctx: OdtContext): string {
  let out = "";
  for (const node of nodes) {
    if (!isElement(node)) continue;
    switch (node.name) {
      case "text:h": {
        const level = Math.min(Math.max(Number(node.attrs["text:outline-level"] ?? 1) || 1, 1), 6);
        out += `<h${level}>${inlineHtml(node.children, ctx)}</h${level}>`;
        break;
      }
      case "text:p": {
        const styleName = node.attrs["text:style-name"] ?? "";
        const inner = wrapStyled(inlineHtml(node.children, ctx), resolveStyle(ctx, styleName));
        if (/^(title)$/i.test(styleName)) out += `<h1>${inner}</h1>`;
        else if (/^(subtitle)$/i.test(styleName)) out += `<h2>${inner}</h2>`;
        else out += inner.trim() ? `<p>${inner}</p>` : "<p><br></p>";
        break;
      }
      case "text:list":
        out += listHtml(node, ctx);
        break;
      case "table:table":
        out += tableHtml(node, ctx);
        break;
      case "draw:frame":
        out += `<p>${frameHtml(node, ctx)}</p>`;
        break;
      case "text:tracked-changes":
      case "office:forms":
      case "text:sequence-decls":
      case "text:variable-decls":
      case "office:annotation":
        break;
      default:
        // text:section, text:table-of-content, text:index-body, office:text, ...
        out += blocksHtml(node.children, ctx);
    }
  }
  return out.replace(/(<p><br><\/p>){2,}/g, "<p><br></p>");
}

function blocksText(nodes: XmlElement["children"], lines: string[]) {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    switch (node.name) {
      case "text:h": {
        const level = Math.min(Number(node.attrs["text:outline-level"] ?? 1) || 1, 6);
        lines.push(`${"#".repeat(level)} ${inlineText(node.children).trim()}`);
        break;
      }
      case "text:p":
        lines.push(inlineText(node.children));
        break;
      case "text:list-item":
        {
          const sub: string[] = [];
          blocksText(node.children, sub);
          sub.forEach((line, idx) => lines.push(idx === 0 ? `- ${line}` : `  ${line}`));
        }
        break;
      case "table:table-row": {
        const cells = childElements(node)
          .filter((c) => c.name === "table:table-cell")
          .map((cell) => {
            const sub: string[] = [];
            blocksText(cell.children, sub);
            return sub.join(" ").trim();
          });
        if (cells.some(Boolean)) lines.push(`| ${cells.join(" | ")} |`);
        break;
      }
      case "office:annotation":
      case "text:tracked-changes":
        break;
      default:
        blocksText(node.children, lines);
    }
  }
}

export interface OdtResult {
  html: string;
  text: string;
}

export async function parseOdt(
  input: Uint8Array | ArrayBuffer,
  options: { withImages?: boolean } = {}
): Promise<OdtResult> {
  const zip = await loadZip(input);
  const content = await readZipXml(zip, "content.xml");
  if (!content) throw new Error("content.xml not found: not a valid ODT document.");

  const ctx: OdtContext = { styles: new Map(), orderedLists: new Set(), images: new Map() };
  collectStyles(await readZipXml(zip, "styles.xml"), ctx);
  collectStyles(content, ctx);

  const officeText = path(content, "office:document-content", "office:body", "office:text");
  if (!officeText) throw new Error("ODT document body not found.");

  if (options.withImages) {
    const hrefs = new Set<string>();
    const walk = (el: XmlElement) => {
      for (const c of childElements(el)) {
        if (c.name === "draw:image" && c.attrs["xlink:href"]) hrefs.add(c.attrs["xlink:href"]);
        walk(c);
      }
    };
    walk(officeText);
    for (const href of hrefs) {
      const mime = renderableImageMime(href);
      if (!mime || /^[a-z]+:/i.test(href)) continue;
      if (zipEntrySize(zip, href) > MAX_IMAGE_BYTES) continue;
      const b64 = await readZipBase64(zip, href);
      if (b64) ctx.images.set(href, `data:${mime};base64,${b64}`);
    }
  }

  const lines: string[] = [];
  blocksText(officeText.children, lines);

  return {
    html: blocksHtml(officeText.children, ctx),
    text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}
