import path from "node:path";
import { extractPdfText } from "./pdf";
import { extractExcelText } from "./excel";
import { extractDocxText } from "./docx";
import { extractPptxText } from "./pptx";
import {
  extractDocText,
  extractEpubText,
  extractOdtText,
  extractRtfText,
} from "./legacy-documents";
import { extractPlainText } from "./text";
import type { ExtractorResult } from "./types";

export * from "./types";
export { extractPdfText } from "./pdf";
export { extractExcelText } from "./excel";
export { extractDocxText } from "./docx";
export { extractPptxText } from "./pptx";
export { extractDocText, extractEpubText, extractOdtText, extractRtfText } from "./legacy-documents";
export { extractPlainText } from "./text";

/**
 * Universal text extractor for documents and files.
 * Automatically chooses the right extractor based on file extension and MIME type.
 * Returns structured clean text with clear page/sheet/slide markers where applicable.
 */
export async function extractDocumentText(
  buffer: Buffer | Uint8Array,
  filename: string,
  mimeType?: string
): Promise<ExtractorResult> {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const ext = path.extname(filename || "").toLowerCase();
  const mime = (mimeType || "").toLowerCase();

  // 1. PDF
  if (ext === ".pdf" || mime === "application/pdf") {
    return extractPdfText(buf);
  }

  // 2. Excel, OpenDocument & other spreadsheets
  if (
    ext === ".xlsx" ||
    ext === ".xls" ||
    ext === ".ods" ||
    mime.includes("spreadsheet") ||
    mime.includes("ms-excel")
  ) {
    return extractExcelText(buf);
  }

  // 3. Rich Text (.rtf) — before .doc: Windows often labels RTF as application/msword
  if (ext === ".rtf" || mime === "application/rtf" || mime === "text/rtf") {
    return extractRtfText(buf);
  }

  // 4. Word Document (.docx)
  if (ext === ".docx" || mime.includes("wordprocessingml")) {
    return extractDocxText(buf);
  }

  // 5. Legacy Word 97–2003 (.doc)
  if (ext === ".doc" || mime === "application/msword") {
    return extractDocText(buf);
  }

  // 6. OpenDocument Text (.odt)
  if (ext === ".odt" || mime === "application/vnd.oasis.opendocument.text") {
    return extractOdtText(buf);
  }

  // 7. EPUB eBook
  if (ext === ".epub" || mime === "application/epub+zip") {
    return extractEpubText(buf);
  }

  // 8. PowerPoint Presentation (.pptx)
  if (
    ext === ".pptx" ||
    mime.includes("presentationml") ||
    mime === "application/vnd.ms-powerpoint"
  ) {
    return extractPptxText(buf);
  }

  // 9. Plain text, markdown, source code, data formats
  const textExtensions = new Set([
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".tsv",
    ".json",
    ".yaml",
    ".yml",
    ".xml",
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".jsx",
    ".py",
    ".sql",
    ".sh",
    ".bash",
    ".env",
    ".ini",
    ".conf",
    ".toml",
    ".log",
    ".svg",
  ]);

  if (textExtensions.has(ext) || mime.startsWith("text/")) {
    return extractPlainText(buf, filename);
  }

  // Fallback: try plain text extraction (detects binary internally)
  const plainResult = await extractPlainText(buf, filename);
  if (plainResult.success) {
    return plainResult;
  }

  return {
    success: false,
    text: "",
    error: `Text extraction is not supported for file type '${ext || mime || "unknown"}'.`,
  };
}
