import type { ExtractorResult } from "./types";

/**
 * Extractor for plain text, markdown, CSV, JSON, and source code files.
 * Normalizes newlines and strips harmful binary/null characters.
 */
export async function extractPlainText(
  buffer: Buffer | Uint8Array,
  filename?: string
): Promise<ExtractorResult> {
  try {
    const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    
    // Check for null bytes to detect accidental binary files
    let nullByteCount = 0;
    const checkLength = Math.min(raw.length, 1024);
    for (let i = 0; i < checkLength; i++) {
      if (raw[i] === 0) nullByteCount++;
    }

    if (nullByteCount > 2) {
      return {
        success: false,
        text: "",
        error: `File '${filename || "file"}' appears to be a binary file, not plain text.`,
      };
    }

    // Decode as UTF-8
    let text = raw.toString("utf8");

    // Remove BOM if present
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
    }

    // Normalize CRLF to LF
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    return {
      success: true,
      text,
      metadata: {
        filename,
        sizeBytes: raw.length,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      text: "",
      error: `Gagal membaca file text: ${message}`,
    };
  }
}
