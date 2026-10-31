/**
 * Section-break handling for docx-preview's parsed document.
 *
 * docx-preview parses each section's `w:type` but never uses it: with
 * `ignoreLastRenderedPageBreak: true` every section starts a new page (continuous sections
 * included), with `false` sections of equal paper size are merged onto one page. Neither
 * matches Word, so the renderer runs with `false` and this marks the sections that really
 * start on a new page with an explicit page break, which docx-preview always honours.
 */

interface DocxNode {
  type: string;
  children?: DocxNode[];
  sectionProps?: { type?: string };
  break?: string;
}

interface ParsedDocx {
  documentPart?: { body?: { children?: DocxNode[]; props?: { type?: string } } };
}

/** Section start types that keep the previous page going. */
const SAME_PAGE_TYPES = new Set(["continuous", "nextColumn"]);

export function markSectionPageBreaks(doc: unknown) {
  const body = (doc as ParsedDocx).documentPart?.body;
  const children = body?.children;
  if (!children) return;

  // a section ends at the paragraph holding its sectPr; the last one uses the body's sectPr
  const ends = children.filter((el) => el.type === "paragraph" && el.sectionProps);
  for (let i = 0; i < ends.length; i++) {
    const nextType = (i + 1 < ends.length ? ends[i + 1].sectionProps : body.props)?.type;
    // a missing w:type means "nextPage", Word's default
    if (nextType && SAME_PAGE_TYPES.has(nextType)) continue;
    const end = ends[i];
    end.children = [...(end.children ?? []), { type: "run", children: [{ type: "break", break: "page" }] }];
  }
}
