import { parseDoc } from "../parsers/doc";
import { openEpub, renderEpubChapter } from "../parsers/epub";
import { parseOdt } from "../parsers/odt";
import { decodeRtfBytes, parseRtf } from "../parsers/rtf";
import { blocksToPlainText } from "../parsers/text-blocks";
import type { ExtractorResult } from "./types";

function failure(err: unknown): ExtractorResult {
  return {
    success: false,
    text: "",
    error: err instanceof Error ? err.message : String(err),
  };
}

function success(text: string, metadata: Record<string, unknown> = {}, count?: number): ExtractorResult {
  const trimmed = text.trim();
  return {
    success: true,
    text: trimmed,
    pageOrSheetCount: count,
    metadata: { charCount: trimmed.length, ...metadata },
  };
}

/** Legacy Word 97–2003 (.doc): paragraphs and tables from the piece table. */
export async function extractDocText(buffer: Buffer): Promise<ExtractorResult> {
  try {
    return success(blocksToPlainText(await parseDoc(new Uint8Array(buffer))));
  } catch (err) {
    return failure(err);
  }
}

/** Rich Text Format (.rtf). */
export async function extractRtfText(buffer: Buffer): Promise<ExtractorResult> {
  try {
    return success(blocksToPlainText(parseRtf(decodeRtfBytes(new Uint8Array(buffer)))));
  } catch (err) {
    return failure(err);
  }
}

/** OpenDocument Text (.odt): headings as Markdown, lists and tables preserved. */
export async function extractOdtText(buffer: Buffer): Promise<ExtractorResult> {
  try {
    const { text } = await parseOdt(new Uint8Array(buffer));
    return success(text);
  } catch (err) {
    return failure(err);
  }
}

/** EPUB: chapters in reading order with `=== [CHAPTER X: Title] ===` delimiters. */
export async function extractEpubText(buffer: Buffer): Promise<ExtractorResult> {
  try {
    const book = await openEpub(new Uint8Array(buffer));
    const sections: string[] = [];
    if (book.title) {
      sections.push(`# ${book.title}${book.author ? `\n${book.author}` : ""}`);
    }
    for (let i = 0; i < book.chapters.length; i++) {
      const chapter = book.chapters[i];
      const { text, heading } = await renderEpubChapter(book, chapter.path);
      if (!text) continue;
      const label = chapter.title || heading;
      sections.push(`=== [CHAPTER ${i + 1}${label ? `: ${label}` : ""}] ===\n${text}`);
    }
    return success(
      sections.join("\n\n"),
      { title: book.title, author: book.author, totalChapters: book.chapters.length },
      book.chapters.length
    );
  } catch (err) {
    return failure(err);
  }
}
