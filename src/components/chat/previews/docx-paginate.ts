/**
 * Splits docx-preview pages whose content runs past the paper height.
 *
 * docx-preview only breaks pages at explicit page breaks and section breaks — it has no
 * layout engine. Documents written without those markers (Google Docs, generators) come
 * out as one tall page, so overflowing pages are re-flowed here by measured block height.
 */

interface Block {
  article: HTMLElement;
  el: HTMLElement;
  top: number;
  bottom: number;
}

function outerHeight(el: HTMLElement): number {
  const style = getComputedStyle(el);
  return el.offsetHeight + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
}

function isMultiColumn(article: HTMLElement): boolean {
  return (parseInt(getComputedStyle(article).columnCount, 10) || 1) > 1;
}

/**
 * Top-level blocks of every article with their laid-out position; multi-column articles move
 * as one block. Positions (not summed heights) keep collapsed margins from being double-counted.
 */
function collectBlocks(articles: HTMLElement[], origin: number): Block[] {
  const blocks: Block[] = [];
  const add = (article: HTMLElement, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    // a block that starts a page keeps its top margin there, so it counts toward that page
    const top = rect.top - (parseFloat(style.marginTop) || 0) - origin;
    const bottom = rect.bottom + (parseFloat(style.marginBottom) || 0) - origin;
    blocks.push({ article, el, top, bottom });
  };
  for (const article of articles) {
    if (isMultiColumn(article)) {
      add(article, article);
      continue;
    }
    for (const el of Array.from(article.children) as HTMLElement[]) add(article, el);
  }
  return blocks;
}

function tableRows(table: HTMLElement): HTMLTableRowElement[] {
  return Array.from(
    table.querySelectorAll<HTMLTableRowElement>(":scope > tr, :scope > tbody > tr, :scope > thead > tr")
  );
}

/**
 * Splits `table` so rows ending above `limit` (relative to `origin`) stay and the rest move
 * into a continuation table placed right after it, like Word breaking a table across pages.
 * Returns false when no row boundary fits, leaving the table untouched.
 */
function splitTable(table: HTMLElement, limit: number, origin: number): boolean {
  const rows = tableRows(table);
  let keep = 0;
  while (keep < rows.length && rows[keep].getBoundingClientRect().bottom - origin <= limit) keep++;
  // every row fits but the table's bottom margin does not: carry the last row over instead
  if (keep === rows.length) keep--;
  if (keep === 0) return false;

  const rest = table.cloneNode(false) as HTMLElement;
  for (const col of Array.from(table.querySelectorAll(":scope > colgroup"))) rest.appendChild(col.cloneNode(true));
  const moved = rows.slice(keep);
  const parent = moved[0].parentElement!;
  const target = parent === table ? rest : (rest.appendChild(parent.cloneNode(false)) as HTMLElement);
  target.append(...moved);
  table.after(rest);
  return true;
}

const MIN_LINES = 2; // Word's widow/orphan control keeps two lines on each side of a break

interface TextPos {
  node: Text;
  offset: number;
}

function textPositions(p: HTMLElement): TextPos[] {
  const out: TextPos[] = [];
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    for (let i = 0; i < n.length; i++) out.push({ node: n, offset: i });
  }
  return out;
}

function charRect(pos: TextPos): DOMRect | null {
  const range = document.createRange();
  range.setStart(pos.node, pos.offset);
  range.setEnd(pos.node, pos.offset + 1);
  const rect = range.getClientRects()[0];
  return rect && rect.height > 0 ? rect : null;
}

/**
 * Splits a paragraph at the first line that ends below `limit`, moving the remaining lines
 * into a continuation paragraph. Numbered paragraphs (CSS counters would repeat the number)
 * and paragraphs holding drawings are left whole.
 */
function splitParagraph(p: HTMLElement, limit: number, origin: number): boolean {
  if (/-num-/.test(p.className) || p.querySelector("img, svg, canvas")) return false;
  const positions = textPositions(p);
  if (positions.length === 0) return false;

  // bottoms grow line by line, so binary-search the first character ending past `bottom`
  const firstPast = (bottom: number) => {
    let lo = 0;
    let hi = positions.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const rect = charRect(positions[mid]);
      if (rect && rect.bottom - origin > bottom) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };

  const lineHeight = positions.map(charRect).find(Boolean)?.height ?? 0;
  if (!lineHeight) return false;
  const pRect = p.getBoundingClientRect();
  // too few lines would follow the break: pull it back so MIN_LINES move together
  const widowLimit = pRect.bottom - origin - MIN_LINES * lineHeight + lineHeight / 2;
  const split = firstPast(Math.min(limit, widowLimit));
  if (split >= positions.length) return false;

  const splitRect = charRect(positions[split]);
  if (!splitRect) return false;
  const linesBefore = Math.round((splitRect.top - pRect.top) / lineHeight);
  if (linesBefore < MIN_LINES) return false;
  const lo = split;

  const range = document.createRange();
  range.setStart(positions[lo].node, positions[lo].offset);
  range.setEnd(p, p.childNodes.length);
  const rest = p.cloneNode(false) as HTMLElement;
  rest.appendChild(range.extractContents());
  // the continuation is the same paragraph: no first-line indent or space between the halves
  rest.style.textIndent = "0";
  rest.style.marginTop = "0";
  p.style.marginBottom = "0";
  p.after(rest);
  return true;
}

/**
 * Breaks the first table or paragraph that crosses a page boundary (at a row or line edge).
 * Returns true when the layout changed and blocks must be measured again.
 */
function splitFirstOverflowingBlock(blocks: Block[], available: number, origin: number): boolean {
  let pageTop = blocks[0]?.top ?? 0;
  let empty = true;
  for (const block of blocks) {
    if (empty) pageTop = block.top;
    if (block.bottom - pageTop > available) {
      const limit = pageTop + available;
      if (block.el.tagName === "TABLE" && splitTable(block.el, limit, origin)) return true;
      if (block.el.tagName === "P" && splitParagraph(block.el, limit, origin)) return true;
      if (!empty) pageTop = block.top;
    }
    empty = false;
  }
  return false;
}

function groupBlocks(blocks: Block[], available: number): Block[][] {
  const groups: Block[][] = [];
  let current: Block[] = [];
  let pageTop = 0;
  for (const block of blocks) {
    if (current.length === 0) pageTop = block.top;
    else if (block.bottom - pageTop > available) {
      groups.push(current);
      current = [];
      pageTop = block.top;
    }
    current.push(block);
  }
  if (current.length) groups.push(current);
  return groups;
}

function buildPage(section: HTMLElement, group: Block[], leading: Element[], trailing: Element[]): HTMLElement {
  const page = section.cloneNode(false) as HTMLElement;
  for (const el of leading) page.appendChild(el.cloneNode(true));

  let target: HTMLElement | null = null;
  let source: HTMLElement | null = null;
  for (const block of group) {
    if (block.el === block.article) {
      page.appendChild(block.article);
      target = source = null;
      continue;
    }
    if (source !== block.article) {
      source = block.article;
      target = block.article.cloneNode(false) as HTMLElement;
      page.appendChild(target);
    }
    target!.appendChild(block.el);
  }

  for (const el of trailing) page.appendChild(el.cloneNode(true));
  return page;
}

function paginateSection(section: HTMLElement) {
  const style = getComputedStyle(section);
  const pageHeight = parseFloat(style.minHeight) || 0;
  if (!pageHeight || section.offsetHeight <= pageHeight + 1) return;

  const children = Array.from(section.children);
  const articles = children.filter((el): el is HTMLElement => el.tagName === "ARTICLE");
  if (articles.length === 0) return;
  const first = children.indexOf(articles[0]);
  const last = children.indexOf(articles[articles.length - 1]);
  const leading = children.slice(0, first);
  const trailingAll = children.slice(last + 1);
  // headers/footers repeat on every page; footnotes and other trailing content stay on the last one
  const footers = trailingAll.filter((el) => el.tagName === "FOOTER");
  const notes = trailingAll.filter((el) => el.tagName !== "FOOTER");

  const chrome = [...leading, ...footers].reduce((sum, el) => sum + outerHeight(el as HTMLElement), 0);
  const available =
    pageHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0) - chrome;
  if (available <= 0) return;

  const origin = section.getBoundingClientRect().top;
  let blocks = collectBlocks(articles, origin);
  // each split moves at least one row forward, so this terminates; the cap guards odd layouts
  for (let i = 0; i < 500 && splitFirstOverflowingBlock(blocks, available, origin); i++) {
    blocks = collectBlocks(articles, origin);
  }
  const groups = groupBlocks(blocks, available);
  if (groups.length <= 1) return;

  const pages = groups.map((group, i) =>
    buildPage(section, group, leading, i === groups.length - 1 ? [...notes, ...footers] : footers)
  );
  section.replaceWith(...pages);
}

/** Resolves once fonts and images inside `root` have their final size, so heights are stable. */
export async function waitForDocxLayout(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all([
    document.fonts?.ready,
    ...images.map((img) => (img.complete ? null : img.decode().catch(() => undefined))),
  ]);
}

/** Re-flows every overflowing page inside `wrapper`. Measures at zoom 1 for stable numbers. */
export function paginateDocxPages(body: HTMLElement, wrapperClassName: string) {
  const prevZoom = body.style.zoom;
  body.style.zoom = "1";
  try {
    const sections = Array.from(
      body.querySelectorAll<HTMLElement>(`.${wrapperClassName} > section`)
    );
    for (const section of sections) paginateSection(section);
  } finally {
    body.style.zoom = prevZoom;
  }
}
