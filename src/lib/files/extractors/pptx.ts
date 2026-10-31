import { parsePptx, pptxToText } from "../parsers/pptx";
import type { ExtractorResult } from "./types";

/**
 * Extracts slide text from PowerPoint presentations (.pptx) in presentation order,
 * including tables and speaker notes. Inserts explicit slide delimiters `=== [SLIDE X] ===`.
 */
export async function extractPptxText(buffer: Buffer): Promise<ExtractorResult> {
  try {
    const doc = await parsePptx(new Uint8Array(buffer), { withMedia: false });
    const trimmed = pptxToText(doc).trim();

    return {
      success: true,
      text: trimmed,
      pageOrSheetCount: doc.slides.length,
      metadata: {
        totalSlides: doc.slides.length,
        charCount: trimmed.length,
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
