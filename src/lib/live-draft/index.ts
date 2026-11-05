import { buildJsDraftSections } from "./javascript";
import { buildPythonDraftSections } from "./python";
import { createDocumentSections, createPresentationSections, createSpreadsheetSections } from "./structured";
import { DRAFT_LIMITS, type DraftBlock, type DraftDocument, type DraftSection } from "./types";

export type { DraftDocument, DraftSection } from "./types";

export interface DraftSource {
  toolName: string;
  input: unknown;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isNodeScript(input: Record<string, unknown>, code: string): boolean {
  if (input.runtime === "node") return true;
  if (input.runtime === "python") return false;
  return /\brequire\s*\(\s*['"]|^\s*import\s+.+\s+from\s+['"]|\bconst\s+\w+\s*=|=>/m.test(code) && !/^\s*(?:from\s+\w+\s+import|import\s+\w+\s*$|def\s+\w+\()/m.test(code);
}

function sectionsFor(source: DraftSource): DraftSection[] {
  const input = rec(source.input);
  switch (source.toolName) {
    case "run_skill_script": {
      const code = typeof input.code === "string" ? input.code : "";
      if (!code.trim()) return [];
      return isNodeScript(input, code) ? buildJsDraftSections(code) : buildPythonDraftSections(code);
    }
    case "create_document":
      return createDocumentSections(input);
    case "create_presentation":
      return createPresentationSections(input);
    case "create_spreadsheet":
      return createSpreadsheetSections(input);
    case "write_file":
    case "edit_file": {
      const filename = String(input.filename ?? input.path ?? "").toLowerCase();
      const content = typeof input.content === "string" ? input.content : typeof input.new_string === "string" ? input.new_string : "";
      if (!content) return [];
      if (/\.(?:md|markdown)$/.test(filename)) return [{ kind: "markdown", text: content }];
      if (/\.html?$/.test(filename)) return [{ kind: "html", html: content }];
      return [];
    }
    default:
      return [];
  }
}

function blocksHaveContent(blocks: DraftBlock[]): boolean {
  return blocks.some((b) => b.type !== "spacer" && b.type !== "pagebreak");
}

function sectionHasContent(section: DraftSection): boolean {
  switch (section.kind) {
    case "flow":
      return blocksHaveContent(section.blocks);
    case "fixed":
      return section.items.length > 0;
    case "sheets":
      return section.sheets.some((s) => s.cells.length > 0);
    case "markdown":
      return section.text.trim().length > 0;
    case "html":
      return section.html.trim().length > 0;
  }
}

function sectionTyping(section: DraftSection): boolean {
  switch (section.kind) {
    case "flow":
      return section.blocks.some((b) => (b.type === "text" || b.type === "table" || b.type === "callout") && Boolean(b.typing));
    case "fixed":
      return section.items.some((i) => i.type === "text" && Boolean(i.typing));
    case "sheets":
      return section.sheets.some((s) => Boolean(s.typing));
    default:
      return false;
  }
}

/**
 * The draft of a document-building tool call, or null when there is nothing to draw
 * (yet) or the code could not be understood. Never throws.
 */
export function buildDraft(source: DraftSource, streaming: boolean): DraftDocument | null {
  try {
    const sections = sectionsFor(source).filter(sectionHasContent).slice(0, DRAFT_LIMITS.sections);
    if (sections.length === 0) return null;
    if (streaming) {
      const lastSection = sections[sections.length - 1];
      if (lastSection.kind === "markdown") lastSection.typing = true;
    }
    return { sections, typing: streaming && sections.some(sectionTyping) };
  } catch {
    return null;
  }
}
