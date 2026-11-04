// @ts-expect-error Bypasses the debug test block in pdf-parse/index.js that triggers ENOENT in ESM/Next.js
import pdf from "pdf-parse/lib/pdf-parse.js";
import type { ExtractorResult } from "./types";

interface PageData {
  pageIndex: number;
  getTextContent: () => Promise<{
    items: Array<{ str: string; transform: number[] }>;
  }>;
}

/**
 * Extracts readable text from a PDF document page-by-page using pdf-parse.
 * Inserts explicit page delimiters `=== [PAGE X] ===` so the AI understands exact page references.
 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractorResult> {
  try {
    const renderPage = async (pageData: PageData): Promise<string> => {
      const textContent = await pageData.getTextContent();
      let lastY: number | undefined;
      let text = "";

      for (const item of textContent.items) {
        if (lastY === item.transform[5] || lastY === undefined) {
          text += item.str;
        } else {
          text += "\n" + item.str;
        }
        lastY = item.transform[5];
      }

      const pageNum = pageData.pageIndex + 1;
      return `\n\n=== [PAGE ${pageNum}] ===\n` + text.trim();
    };

    const data = await pdf(new Uint8Array(buffer) as unknown as Buffer, {
      pagerender: renderPage as unknown as (pageData: unknown) => Promise<string>,
    });

    const totalPages = data.numpages || 1;
    const trimmed = (data.text || "").trim();

    return {
      success: true,
      text: trimmed,
      pageOrSheetCount: totalPages,
      metadata: {
        totalPages,
        charCount: trimmed.length,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      text: "",
      error: `Failed to extract text from PDF: ${message}`,
    };
  }
}
