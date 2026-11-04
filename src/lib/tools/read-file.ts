import sharp from "sharp";
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
  /** Transient base64 data URI injected into the LLM multimodal turn for visual inspection, stripped before DB storage */
  visualDataUrl?: string;
}

function isImageFile(filename: string, mimeType: string): boolean {
  if (mimeType.toLowerCase().startsWith("image/")) return true;
  return /\.(?:png|jpe?g|webp|gif)$/i.test(filename);
}

export const readFileTool: ToolDefinition<ReadFileParams, ReadFileData> = {
  name: "read_file",
  description:
    "Reads and extracts clean, human-readable text from files in session storage in line-delimited chunks (up to 100 lines per call), OR loads an image file (.png, .jpg, .webp) from session storage for direct visual inspection by vision-capable models (e.g. after running `convert_pdf_to_images.py` or `generate_image`). Automatically parses PDF documents (with page markers === [PAGE X] ===), Word DOCX (with page markers === [PAGE X] === when the file records page breaks), DOC, RTF, OpenDocument ODT, Excel/ODS spreadsheets (with sheet markers === [SHEET: X] ===), PowerPoint PPTX (with slide markers === [SLIDE X] ===), EPUB eBooks (with chapter markers === [CHAPTER X] ===), Markdown, CSV, code files, and images.",
  parameters: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description:
          "The name, clean name, or unique file ID of the file or image to read/inspect from session storage (as listed in [Active Session Files] or created by `run_skill_script` / `generate_image`).",
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

    if (!rawFilename || rawFilename.includes("..") || /[\0]/.test(rawFilename)) {
      return {
        success: false,
        error: { code: "INVALID_PARAM", message: "Invalid or unsafe filename provided." },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    // Flatten relative paths like "poster_preview/page_1.png" -> "poster_preview_page_1.png"
    const normalizedInput = rawFilename.replace(/^[./\\]+/, "").replace(/[/\\]/g, "_");
    const safeFilename = sanitizeKey(normalizedInput);

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
        const queryLower = normalizedInput.toLowerCase();
        const querySafe = safeFilename.toLowerCase();

        const match = sessionFiles.find((f) => {
          if (f.publicId.toLowerCase() === queryLower) return true;
          if (f.filename.toLowerCase() === querySafe) return true;
          const cleanName = f.filename.replace(/^\d+-[a-f0-9]+-/, "").toLowerCase();
          if (cleanName === querySafe || cleanName === queryLower) return true;
          const cleanStem = cleanName.replace(/(?:\.(?:png|jpe?g|webp))?\.[^/.]+$/i, "");
          const queryStem = queryLower.replace(/(?:\.(?:png|jpe?g|webp))?\.[^/.]+$/i, "");
          if (cleanStem === queryStem) return true;
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

      // Handle visual image inspection (.png, .jpg, .jpeg, .webp, .gif)
      if (isImageFile(targetStorageFilename, downloaded.contentType)) {
        try {
          const img = sharp(downloaded.content);
          const meta = await img.metadata();
          const width = meta.width ?? 0;
          const height = meta.height ?? 0;
          const resizedBuffer = await img
            .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
            .png({ compressionLevel: 8 })
            .toBuffer();
          const visualDataUrl = `data:image/png;base64,${resizedBuffer.toString("base64")}`;
          const infoText =
            `1\t[Visual Image Loaded: '${safeFilename}' (${width}x${height} px, ${downloaded.contentType})]\n` +
            `2\tThe rendered image has been attached directly to this conversation turn so you can visually inspect its layout, typography, contrast, alignment, and illustrations.`;
          return {
            success: true,
            data: {
              filename: safeFilename,
              startLine: 1,
              endLine: 2,
              totalLines: 2,
              hasMore: false,
              nextStartLine: null,
              content: infoText,
              mimeType: downloaded.contentType || "image/png",
              visualDataUrl,
            },
            metadata: { durationMs: Date.now() - startTime, provider: "cloudflare-r2-vision" },
          };
        } catch {
          const b64 = downloaded.content.toString("base64");
          const mime = downloaded.contentType.startsWith("image/")
            ? downloaded.contentType
            : "image/png";
          return {
            success: true,
            data: {
              filename: safeFilename,
              startLine: 1,
              endLine: 1,
              totalLines: 1,
              hasMore: false,
              nextStartLine: null,
              content: `1\t[Visual Image Loaded: '${safeFilename}' (${mime})]`,
              mimeType: mime,
              visualDataUrl: `data:${mime};base64,${b64}`,
            },
            metadata: { durationMs: Date.now() - startTime, provider: "cloudflare-r2-vision" },
          };
        }
      }

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
