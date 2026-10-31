/**
 * Case-insensitive text search over a rendered DOM subtree.
 * Returns live Ranges (matches may span several text nodes, e.g. Word runs),
 * suitable for the CSS Custom Highlight API. Pure DOM: no markup is mutated.
 */

const SKIPPED_PARENTS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
const MAX_MATCHES = 2000;

interface TextSegment {
  node: Text;
  /** Offset of this node's first char in the concatenated text */
  start: number;
}

function collectSegments(root: Node): { segments: TextSegment[]; text: string } {
  const segments: TextSegment[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || SKIPPED_PARENTS.has(parent.tagName) || parent.closest("[hidden]")) {
        return NodeFilter.FILTER_REJECT;
      }
      return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    segments.push({ node: node as Text, start: text.length });
    text += node.nodeValue;
  }
  return { segments, text };
}

/** Segment containing the given concatenated-text offset (binary search). */
function segmentAt(segments: TextSegment[], offset: number): TextSegment {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].start <= offset) lo = mid;
    else hi = mid - 1;
  }
  return segments[lo];
}

export function findTextRanges(root: Node, query: string): Range[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const { segments, text } = collectSegments(root);
  if (segments.length === 0) return [];

  // toLowerCase can change length for a few scripts; fall back to exact-case search then
  const haystack = text.toLowerCase();
  const source = haystack.length === text.length ? haystack : text;
  const target = haystack.length === text.length ? needle : query.trim();

  const ranges: Range[] = [];
  let pos = source.indexOf(target);
  while (pos !== -1 && ranges.length < MAX_MATCHES) {
    const end = pos + target.length;
    const first = segmentAt(segments, pos);
    const last = segmentAt(segments, end - 1);
    const range = document.createRange();
    range.setStart(first.node, pos - first.start);
    range.setEnd(last.node, end - last.start);
    ranges.push(range);
    pos = source.indexOf(target, end);
  }
  return ranges;
}

export const SEARCH_HIGHLIGHT = "devnuby-doc-search";
export const SEARCH_HIGHLIGHT_ACTIVE = "devnuby-doc-search-active";

function registry(): HighlightRegistry | null {
  return typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : null;
}

/** Paints all matches plus the active one; no-op where the Highlight API is unavailable. */
export function paintSearchHighlights(ranges: Range[], activeIndex: number) {
  const reg = registry();
  if (!reg) return;
  reg.set(SEARCH_HIGHLIGHT, new Highlight(...ranges));
  const active = ranges[activeIndex];
  if (active) reg.set(SEARCH_HIGHLIGHT_ACTIVE, new Highlight(active));
  else reg.delete(SEARCH_HIGHLIGHT_ACTIVE);
}

export function clearSearchHighlights() {
  const reg = registry();
  reg?.delete(SEARCH_HIGHLIGHT);
  reg?.delete(SEARCH_HIGHLIGHT_ACTIVE);
}

/** Scrolls `scroller` so the rect sits about a third of the way down the viewport. */
export function scrollRectIntoView(scroller: HTMLElement, rect: DOMRect, smooth = true) {
  const box = scroller.getBoundingClientRect();
  const top = scroller.scrollTop + (rect.top - box.top) - scroller.clientHeight / 3;
  const left = scroller.scrollLeft + (rect.left - box.left) - scroller.clientWidth / 2 + rect.width / 2;
  scroller.scrollTo({
    top: Math.max(0, top),
    left: scroller.scrollWidth > scroller.clientWidth ? Math.max(0, left) : undefined,
    behavior: smooth ? "smooth" : "auto",
  });
}
