import type { ExtractorResult } from "./types";

/**
 * Extracts structured text and Markdown from Word documents (.docx) using mammoth.
 * Retains headings, bullet points, and tables.
 */
export async function extractDocxText(buffer: Buffer): Promise<ExtractorResult> {
  try {
    const mammoth = (await import("mammoth")) as unknown as {
      convertToMarkdown: (options: { buffer: Buffer }) => Promise<{ value: string; messages: unknown[] }>;
    };
    const result = await mammoth.convertToMarkdown({ buffer });

    const trimmed = (result.value || "").trim();

    return {
      success: true,
      text: trimmed,
      metadata: {
        charCount: trimmed.length,
        warnings: result.messages,
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
