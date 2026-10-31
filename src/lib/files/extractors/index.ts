import path from "node:path";
import { extractPdfText } from "./pdf";
import { extractExcelText } from "./excel";
import { extractDocxText } from "./docx";
import { extractPptxText } from "./pptx";
import { extractPlainText } from "./text";
import type { ExtractorResult } from "./types";

export * from "./types";
export { extractPdfText } from "./pdf";
export { extractExcelText } from "./excel";
export { extractDocxText } from "./docx";
export { extractPptxText } from "./pptx";
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

  // 2. Excel & Spreadsheets
  if (
    ext === ".xlsx" ||
    ext === ".xls" ||
    mime.includes("spreadsheet") ||
    mime.includes("ms-excel")
  ) {
    return extractExcelText(buf);
  }

  // 3. Word Document (.docx)
  if (
    ext === ".docx" ||
    mime.includes("wordprocessingml") ||
    mime === "application/msword"
  ) {
    return extractDocxText(buf);
  }

  // 4. PowerPoint Presentation (.pptx)
  if (
    ext === ".pptx" ||
    mime.includes("presentationml") ||
    mime === "application/vnd.ms-powerpoint"
  ) {
    return extractPptxText(buf);
  }

  // 5. Plain text, markdown, source code, data formats
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
    error: `Ekstraksi teks tidak didukung untuk tipe file '${ext || mime || "unknown"}'.`,
  };
}
