import { downloadFromR2, sanitizeKey } from "../storage/r2";
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
    "Reads text or document files from session storage in line-delimited chunks (up to 100 lines per call) to optimize context usage.",
  parameters: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "The name of the file to read from the current session storage.",
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

    const rawStart = typeof params.startLine === "number" ? Math.floor(params.startLine) : 1;
    const startLine = Math.max(rawStart, 1);

    const rawMax = typeof params.maxLines === "number" ? Math.floor(params.maxLines) : DEFAULT_LINES;
    const maxLines = Math.min(Math.max(rawMax, 1), MAX_LINES_PER_READ);

    try {
      const downloaded = await downloadFromR2({
        userId: context.userId,
        sessionId: context.sessionId,
        filename: safeFilename,
      });

      const fullText = downloaded.content.toString("utf8");
      const allLines = fullText.split(/\r?\n/);
      const totalLines = allLines.length;

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
    } catch (err: any) {
      const isNotFound = err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404;
      return {
        success: false,
        error: {
          code: isNotFound ? "NOT_FOUND" : "STORAGE_ERROR",
          message: isNotFound
            ? `File '${safeFilename}' was not found in session storage.`
            : "Failed to read file from storage.",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }
  },
};
