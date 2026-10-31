import { db } from "../db";
import { downloadFromR2, sanitizeKey } from "../storage/r2";
import { extractDocumentText } from "../files/extractors";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";

const MAX_LINES_PER_READ = 100;
const DEFAULT_LINES = 100;
const MAX_LINE_CHARACTERS = 2000;

export interface ReadFileParams {
  filename: string;
  startLine?: number;
  maxLines?: number;
}

export interface ReadFileData {
  filename: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  hasMore: boolean;
  nextStartLine: number | null;
  content: string;
  mimeType: string;
}

export const readFileTool: ToolDefinition<ReadFileParams, ReadFileData> = {
  name: "read_file",
  description:
    "Reads and extracts clean, human-readable text from files in session storage in line-delimited chunks (up to 100 lines per call). Automatically parses PDF documents (with page markers === [PAGE X] ===), Word DOCX (with page markers === [PAGE X] === when the file records page breaks), DOC, RTF, OpenDocument ODT, Excel/ODS spreadsheets (with sheet markers === [SHEET: X] ===), PowerPoint PPTX (with slide markers === [SLIDE X] ===), EPUB eBooks (with chapter markers === [CHAPTER X] ===), Markdown, CSV, and code files. ALWAYS use this tool to inspect uploaded documents.",
  parameters: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description:
          "The name, clean name, or unique file ID of the file to read from session storage (as listed in [Active Session Files]).",
        required: true,
      },
      startLine: {
        type: "number",
        description: "The 1-indexed starting line number to read (default: 1).",
        default: 1,
      },
      maxLines: {
        type: "number",
        description: "The number of lines to read (min: 1, max: 100, default: 100).",
        default: 100,
      },
    },
    required: ["filename"],
  },
  execute: async (
    params: ReadFileParams,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<ReadFileData>> => {
    const startTime = Date.now();
    const rawFilename = (params.filename || "").trim().replace(/[.\s]+$/, "");

    if (!rawFilename || rawFilename.includes("..") || /[\\/\0]/.test(rawFilename)) {
      return {
        success: false,
        error: { code: "INVALID_PARAM", message: "Invalid or unsafe filename provided." },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    const safeFilename = sanitizeKey(rawFilename);

    // 1. Resolve storage filename via session files in DB (supports unique file ID, clean name, or full storage name)
    let targetStorageFilename = safeFilename;

    try {
      const sessionFiles = await db.sessionFile.findMany({
        where: {
          session: { publicId: context.sessionId },
        },
        select: {
          publicId: true,
          filename: true,
          mimeType: true,
        },
      });

      if (sessionFiles.length > 0) {
        const queryLower = rawFilename.toLowerCase();
        const querySafe = safeFilename.toLowerCase();

        const match = sessionFiles.find((f) => {
          // Direct publicId match
          if (f.publicId.toLowerCase() === queryLower) return true;
          // Direct storage filename match
          if (f.filename.toLowerCase() === querySafe) return true;
          // Clean name match (strip timestamp-random prefix like "1793345483582-ba80aa05-")
          const cleanName = f.filename.replace(/^\d+-[a-f0-9]+-/, "").toLowerCase();
          if (cleanName === querySafe || cleanName === queryLower) return true;
          // Match if clean name without extension matches
          const cleanStem = cleanName.replace(/\.[^/.]+$/, "");
          const queryStem = queryLower.replace(/\.[^/.]+$/, "");
          if (cleanStem === queryStem) return true;
          // Match if filename ends with query (e.g. -Testing_Artificial_Intelligence.pdf)
          if (f.filename.toLowerCase().endsWith(`-${querySafe}`)) return true;
          if (f.filename.toLowerCase().endsWith(querySafe)) return true;
          return false;
        });

        if (match) {
          targetStorageFilename = match.filename;
        }
      }
    } catch {
      // Non-fatal, fallback to direct safeFilename
    }

    const rawStart = typeof params.startLine === "number" ? Math.floor(params.startLine) : 1;
    const startLine = Math.max(rawStart, 1);

    const rawMax = typeof params.maxLines === "number" ? Math.floor(params.maxLines) : DEFAULT_LINES;
    const maxLines = Math.min(Math.max(rawMax, 1), MAX_LINES_PER_READ);

    try {
      const downloaded = await downloadFromR2({
        userId: context.userId,
        sessionId: context.sessionId,
        filename: targetStorageFilename,
      });

      // Extract clean text from the document (PDF, spreadsheets, Word, RTF, ODT, PPTX, EPUB, or plain text)
      const extraction = await extractDocumentText(
        downloaded.content,
        targetStorageFilename,
        downloaded.contentType
      );

      if (!extraction.success) {
        return {
          success: false,
          error: {
            code: "EXECUTION_ERROR",
            message: `Failed to read contents of '${rawFilename}': ${extraction.error || "Unsupported format"}`,
          },
          metadata: { durationMs: Date.now() - startTime, provider: "cloudflare-r2" },
        };
      }

      const fullText = extraction.text;
      const allLines = fullText ? fullText.split(/\r?\n/) : [];
      const totalLines = allLines.length;

      if (totalLines === 0) {
        return {
          success: true,
          data: {
            filename: safeFilename,
            startLine: 1,
            endLine: 0,
            totalLines: 0,
            hasMore: false,
            nextStartLine: null,
            content: `[File '${safeFilename}' is empty or has no extractable text]`,
            mimeType: downloaded.contentType,
          },
          metadata: { durationMs: Date.now() - startTime, provider: "cloudflare-r2" },
        };
      }

      if (startLine > totalLines) {
        return {
          success: true,
          data: {
            filename: safeFilename,
            startLine,
            endLine: totalLines,
            totalLines,
            hasMore: false,
            nextStartLine: null,
            content: `[File has ${totalLines} line(s). Requested startLine ${startLine} is out of bounds.]`,
            mimeType: downloaded.contentType,
          },
          metadata: { durationMs: Date.now() - startTime, provider: "cloudflare-r2" },
        };
      }

      const startIndex = startLine - 1;
      const endIndex = Math.min(startIndex + maxLines, totalLines);
      const targetLines = allLines.slice(startIndex, endIndex);

      const formattedLines = targetLines.map((line, idx) => {
        const lineNum = startIndex + idx + 1;
        const safeLine =
          line.length > MAX_LINE_CHARACTERS
            ? `${line.slice(0, MAX_LINE_CHARACTERS)}... [truncated: line exceeds max display length]`
            : line;
        return `${lineNum}\t${safeLine}`;
      });

      const actualEndLine = endIndex;
      const hasMore = actualEndLine < totalLines;
      const nextStartLine = hasMore ? actualEndLine + 1 : null;

      return {
        success: true,
        data: {
          filename: safeFilename,
          startLine,
          endLine: actualEndLine,
          totalLines,
          hasMore,
          nextStartLine,
          content: formattedLines.join("\n"),
          mimeType: downloaded.contentType,
        },
        metadata: { durationMs: Date.now() - startTime, provider: "cloudflare-r2" },
      };
    } catch (err) {
      console.error("[READ_FILE_ERROR]", err);
      const typed = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
      const isNotFound = typed.name === "NoSuchKey" || typed.$metadata?.httpStatusCode === 404;
      return {
        success: false,
        error: {
          code: isNotFound ? "NOT_FOUND" : "STORAGE_ERROR",
          message: isNotFound
            ? `File '${safeFilename}' was not found in session storage.`
            : `Failed to read file from storage: ${err instanceof Error ? err.message : String(err)}`,
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }
  },
};