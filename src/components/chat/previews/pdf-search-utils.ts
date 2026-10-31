import type { PDFDocumentProxy } from "pdfjs-dist";

export interface PdfSearchMatch {
  id: string;
  pageNumber: number;
  matchIndexInPage: number;
}

/**
 * Extracts and caches full text for a given PDF page.
 */
export async function getPageText(
  doc: PDFDocumentProxy,
  pageNumber: number,
  cache: Map<number, string>
): Promise<string> {
  const cached = cache.get(pageNumber);
  if (cached !== undefined) return cached;

  try {
    const page = await doc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const joined = textContent.items
      .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
      .join("");
    cache.set(pageNumber, joined);
    return joined;
  } catch {
    cache.set(pageNumber, "");
    return "";
  }
}

/**
 * Searches across all pages in the PDF document for the query.
 * Returns an array of global matches.
 */
export async function searchAllPages(
  doc: PDFDocumentProxy,
  query: string,
  cache: Map<number, string>,
  signal?: AbortSignal
): Promise<PdfSearchMatch[]> {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return [];

  const matches: PdfSearchMatch[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    if (signal?.aborted) return [];
    const text = await getPageText(doc, p, cache);
    if (signal?.aborted) return [];

    const lower = text.toLowerCase();
    let pos = 0;
    let localIdx = 0;

    while (pos < lower.length) {
      const found = lower.indexOf(cleanQuery, pos);
      if (found === -1) break;
      matches.push({
        id: `p${p}-m${localIdx}`,
        pageNumber: p,
        matchIndexInPage: localIdx,
      });
      localIdx++;
      pos = found + Math.max(1, cleanQuery.length);
    }
  }

  return matches;
}

/**
 * Highlights matches inside the rendered PDF.js textLayer container.
 * Supports cross-span matches and smoothly updates active match state.
 */
export function highlightPageSpans(
  container: HTMLElement,
  query: string,
  activeMatchIndexInPage: number | null
): HTMLElement | null {
  const cleanQuery = query.trim().toLowerCase();

  // If query is empty, restore all original text
  if (!cleanQuery) {
    for (const child of Array.from(container.children)) {
      if (child instanceof HTMLElement && child.dataset.rawText !== undefined) {
        if (child.textContent !== child.dataset.rawText) {
          child.textContent = child.dataset.rawText;
        }
      }
    }
    return null;
  }

  const spans = Array.from(container.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement
  );
  if (spans.length === 0) return null;

  // Check if spans are already sliced with the current query:
  // If container's current highlighted query matches, only toggle .is-active
  if (container.dataset.highlightQuery === cleanQuery) {
    let activeMark: HTMLElement | null = null;
    const allMarks = container.querySelectorAll<HTMLElement>("mark.devnuby-pdf-match");
    for (const mark of allMarks) {
      const markIdx = Number(mark.dataset.matchIdx);
      const shouldBeActive = markIdx === activeMatchIndexInPage;
      if (shouldBeActive) {
        mark.classList.add("is-active");
        activeMark = mark;
      } else {
        mark.classList.remove("is-active");
      }
    }
    return activeMark;
  }

  // Calculate full page text from spans while recording offsets
  let totalLength = 0;
  const spanRanges = spans.map((span) => {
    if (span.dataset.rawText === undefined) {
      span.dataset.rawText = span.textContent || "";
    }
    const raw = span.dataset.rawText;
    const start = totalLength;
    const end = start + raw.length;
    totalLength = end;
    return { span, raw, start, end };
  });

  const fullText = spanRanges.map((r) => r.raw).join("");
  const lowerFull = fullText.toLowerCase();

  // Find all match occurrences on this page
  const occurrences: Array<{ start: number; end: number; matchIndexInPage: number }> = [];
  let pos = 0;
  let matchIndex = 0;
  while (pos < lowerFull.length) {
    const found = lowerFull.indexOf(cleanQuery, pos);
    if (found === -1) break;
    occurrences.push({
      start: found,
      end: found + cleanQuery.length,
      matchIndexInPage: matchIndex++,
    });
    pos = found + Math.max(1, cleanQuery.length);
  }

  container.dataset.highlightQuery = cleanQuery;
  let targetActiveMark: HTMLElement | null = null;

  // Apply highlights to each span
  for (const { span, raw, start, end } of spanRanges) {
    const intersections = occurrences
      .map((occ) => {
        const oStart = Math.max(start, occ.start);
        const oEnd = Math.min(end, occ.end);
        if (oStart < oEnd) {
          return {
            localStart: oStart - start,
            localEnd: oEnd - start,
            matchIndexInPage: occ.matchIndexInPage,
          };
        }
        return null;
      })
      .filter((it): it is NonNullable<typeof it> => it !== null);

    if (intersections.length === 0) {
      if (span.textContent !== raw) {
        span.textContent = raw;
      }
      continue;
    }

    intersections.sort((a, b) => a.localStart - b.localStart);
    const fragment = document.createDocumentFragment();
    let cursor = 0;

    for (const inter of intersections) {
      if (inter.localStart > cursor) {
        fragment.appendChild(document.createTextNode(raw.slice(cursor, inter.localStart)));
      }

      const mark = document.createElement("mark");
      const isActive = inter.matchIndexInPage === activeMatchIndexInPage;
      mark.className = `devnuby-pdf-match${isActive ? " is-active" : ""}`;
      mark.dataset.matchIdx = String(inter.matchIndexInPage);
      mark.textContent = raw.slice(inter.localStart, inter.localEnd);

      if (isActive && !targetActiveMark) {
        targetActiveMark = mark;
      }

      fragment.appendChild(mark);
      cursor = inter.localEnd;
    }

    if (cursor < raw.length) {
      fragment.appendChild(document.createTextNode(raw.slice(cursor)));
    }

    span.replaceChildren(fragment);
  }

  return targetActiveMark;
}
