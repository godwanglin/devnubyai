import { parseDocxText } from "../parsers/docx";
import type { ExtractorResult } from "./types";

/**
 * Extracts structured text from Word documents (.docx).
 * Headings, lists, tables, hyperlinks, headers/footers and footnotes are kept.
 * Page markers `=== [PAGE X] ===` come from Word's rendered page breaks; without them
 * no page numbers are claimed.
 */
export async function extractDocxText(buffer: Buffer): Promise<ExtractorResult> {
  try {
    const { text, pageCount } = await parseDocxText(new Uint8Array(buffer.slice(0)));

    return {
      success: true,
      text,
      metadata: {
        charCount: text.length,
        pageCount,
      },
    };
  } catch (err) {
    return {
      success: false,
      text: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
