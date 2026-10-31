import { db } from "../db";
import { uploadToR2, downloadFromR2, sanitizeKey } from "../storage/r2";
import {
  MAX_FILE_BYTES,
  BLOCKED_EXTENSIONS,
  getFileExtension,
} from "../files/policy";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";

export interface SingleEditHunk {
  targetText?: string;
  replacementText: string;
  startLine?: number;
  endLine?: number;
}

export interface EditFileParams {
  filename: string;
  targetText?: string;
  replacementText?: string;
  startLine?: number;
  endLine?: number;
  mode?: "replace" | "insert_before" | "insert_after" | "replace_lines";
  occurrence?: "first" | "last" | "all" | number;
  edits?: SingleEditHunk[];
}

export interface EditFileData {
  id?: string;
  filename: string;
  displayName: string;
  mimeType?: string;
  sizeBytes?: number;
  linesChanged: {
    added: number;
    removed: number;
  };
  diff: string;
  totalLines: number;
  url: string;
}

/**
 * Generates a clean unified diff patch format.
 */
function generateUnifiedDiff(
  filename: string,
  startLine: number,
  oldLines: string[],
  newLines: string[]
): string {
  const oldCount = oldLines.length;
  const newCount = newLines.length;

  const header = `--- a/${filename}\n+++ b/${filename}\n@@ -${startLine},${oldCount} +${startLine},${newCount} @@\n`;
  const removedStr = oldLines.map((l) => `-${l}`).join("\n");
  const addedStr = newLines.map((l) => `+${l}`).join("\n");

  const parts = [header];
  if (removedStr) parts.push(removedStr);
  if (addedStr) parts.push(addedStr);
  return parts.join("\n");
}

/**
 * Fuzzy search lines by trimming leading/trailing whitespace.
 */
function findFuzzyLineSequence(
  fileLines: string[],
  targetLines: string[],
  hintStartLine?: number
): number {
  if (targetLines.length === 0 || fileLines.length === 0) return -1;

  const cleanTargets = targetLines.map((l) => l.trim());
  const maxSearchStart = fileLines.length - cleanTargets.length;

  // If hintStartLine is provided, search near it first
  const order: number[] = [];
  if (typeof hintStartLine === "number" && hintStartLine >= 1 && hintStartLine <= fileLines.length) {
    const center = hintStartLine - 1;
    order.push(center);
    for (let offset = 1; offset <= Math.max(center, fileLines.length - center); offset++) {
      if (center - offset >= 0) order.push(center - offset);
      if (center + offset <= maxSearchStart) order.push(center + offset);
    }
  } else {
    for (let i = 0; i <= maxSearchStart; i++) order.push(i);
  }

  for (const startIdx of order) {
    if (startIdx > maxSearchStart || startIdx < 0) continue;
    let match = true;
    for (let j = 0; j < cleanTargets.length; j++) {
      if (fileLines[startIdx + j].trim() !== cleanTargets[j]) {
        match = false;
        break;
      }
    }
    if (match) return startIdx;
  }

  return -1;
}

export const editFileTextTool: ToolDefinition<EditFileParams, EditFileData> = {
  name: "edit_file",
  description:
    "Performs precise, token-efficient surgical edits on an existing text or code file (.html, .css, .js, .ts, .md, .json, .csv, .py, etc.) in the session. Supports target snippet replacement, line-range replacement (e.g. Line 24-28), fuzzy matching, and multi-hunk diffs without rewriting the whole file.",
  parameters: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "The name, clean filename, or unique publicId of the session file to edit.",
        required: true,
      },
      targetText: {
        type: "string",
        description: "The exact or approximate snippet of text/code to find and replace. Whitespace differences are tolerated automatically.",
      },
      replacementText: {
        type: "string",
        description: "The new content to put in place of the target text.",
      },
      startLine: {
        type: "number",
        description: "Optional 1-based start line number for line-based replacement or to disambiguate target location.",
      },
      endLine: {
        type: "number",
        description: "Optional 1-based end line number for line-based replacement.",
      },
      mode: {
        type: "string",
        enum: ["replace", "insert_before", "insert_after", "replace_lines"],
        description: "The editing operation mode. Defaults to 'replace'.",
      },
      edits: {
        type: "array",
        description: "Optional list of multiple edit hunks to apply sequentially in a single tool call.",
        items: {
          type: "object",
          properties: {
            targetText: { type: "string" },
            replacementText: { type: "string" },
            startLine: { type: "number" },
            endLine: { type: "number" },
          },
          required: ["replacementText"],
        },
      },
    },
    required: ["filename"],
  },
  execute: async (
    params: EditFileParams,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<EditFileData>> => {
    const startTime = Date.now();
    const rawFilename = (params.filename || "").trim();

    if (!rawFilename) {
      return {
        success: false,
        error: { code: "INVALID_PARAM", message: "Parameter 'filename' is required." },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    const safeFilename = sanitizeKey(rawFilename);
    const extension = getFileExtension(safeFilename);

    if (BLOCKED_EXTENSIONS.has(extension)) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAM",
          message: `Extension '${extension}' is an executable or installer binary and cannot be edited.`,
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    // Smart file resolver (same as read-file)
    let targetStorageFilename = safeFilename;
    let filePublicId: string | undefined;
    let fileMimeType = "text/plain";

    try {
      const sessionFiles = await db.sessionFile.findMany({
        where: { session: { publicId: context.sessionId } },
        select: { publicId: true, filename: true, mimeType: true },
      });

      if (sessionFiles.length > 0) {
        const queryLower = rawFilename.toLowerCase();
        const querySafe = safeFilename.toLowerCase();

        const match = sessionFiles.find((f) => {
          if (f.publicId.toLowerCase() === queryLower) return true;
          if (f.filename.toLowerCase() === querySafe) return true;
          const clean = f.filename.replace(/^\d+-[a-f0-9]+-/, "").toLowerCase();
          if (clean === querySafe || clean === queryLower) return true;
          if (clean.replace(/\.[^/.]+$/, "") === queryLower.replace(/\.[^/.]+$/, "")) return true;
          if (f.filename.toLowerCase().endsWith(`-${querySafe}`)) return true;
          if (f.filename.toLowerCase().endsWith(querySafe)) return true;
          return false;
        });

        if (match) {
          targetStorageFilename = match.filename;
          filePublicId = match.publicId;
          fileMimeType = match.mimeType;
        }
      }
    } catch {
      // Non-fatal, fallback to safeFilename
    }

    try {
      const downloaded = await downloadFromR2({
        userId: context.userId,
        sessionId: context.sessionId,
        filename: targetStorageFilename,
      });

      const originalContent = downloaded.content.toString("utf8");
      const isCrlf = originalContent.includes("\r\n");
      const newline = isCrlf ? "\r\n" : "\n";
      const fileLines = originalContent.split(/\r?\n/);

      // Collect hunks to process
      const hunks: SingleEditHunk[] =
        params.edits && params.edits.length > 0
          ? params.edits
          : [
              {
                targetText: params.targetText,
                replacementText: params.replacementText ?? "",
                startLine: params.startLine,
                endLine: params.endLine,
              },
            ];

      const workingLines = [...fileLines];
      let totalAdded = 0;
      let totalRemoved = 0;
      const diffChunks: string[] = [];

      for (const hunk of hunks) {
        const replLines = hunk.replacementText.split(/\r?\n/);

        // Case A: Line-range replacement (explicit line numbers)
        if (
          typeof hunk.startLine === "number" &&
          hunk.startLine >= 1 &&
          (!hunk.targetText || params.mode === "replace_lines")
        ) {
          const sIdx = hunk.startLine - 1;
          const eIdx =
            typeof hunk.endLine === "number" && hunk.endLine >= hunk.startLine
              ? Math.min(hunk.endLine, workingLines.length)
              : sIdx + 1;

          const oldSlice = workingLines.slice(sIdx, eIdx);
          workingLines.splice(sIdx, oldSlice.length, ...replLines);

          totalRemoved += oldSlice.length;
          totalAdded += replLines.length;

          diffChunks.push(generateUnifiedDiff(safeFilename, hunk.startLine, oldSlice, replLines));
          continue;
        }

        // Case B: Target snippet replacement / insertion
        const targetStr = hunk.targetText || "";
        if (!targetStr) {
          return {
            success: false,
            error: {
              code: "INVALID_PARAM",
              message: "Each edit hunk must provide either 'targetText' or 'startLine'.",
            },
            metadata: { durationMs: Date.now() - startTime },
          };
        }

        const targetLines = targetStr.split(/\r?\n/);

        // 1. Try exact line sequence matching first
        let foundLineIdx = -1;
        for (let i = 0; i <= workingLines.length - targetLines.length; i++) {
          let match = true;
          for (let j = 0; j < targetLines.length; j++) {
            if (workingLines[i + j] !== targetLines[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            foundLineIdx = i;
            break;
          }
        }

        // 2. Fallback to fuzzy / whitespace-tolerant matching
        if (foundLineIdx === -1) {
          foundLineIdx = findFuzzyLineSequence(workingLines, targetLines, hunk.startLine);
        }

        if (foundLineIdx === -1) {
          return {
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `Target text was not found in '${safeFilename}'. Please inspect the file with read_file first.`,
            },
            metadata: { durationMs: Date.now() - startTime },
          };
        }

        const oldSlice = workingLines.slice(foundLineIdx, foundLineIdx + targetLines.length);

        let finalReplLines: string[] = [];
        if (params.mode === "insert_before") {
          finalReplLines = [...replLines, ...oldSlice];
        } else if (params.mode === "insert_after") {
          finalReplLines = [...oldSlice, ...replLines];
        } else {
          finalReplLines = replLines;
        }

        workingLines.splice(foundLineIdx, oldSlice.length, ...finalReplLines);

        totalRemoved += oldSlice.length;
        totalAdded += finalReplLines.length;

        diffChunks.push(
          generateUnifiedDiff(safeFilename, foundLineIdx + 1, oldSlice, finalReplLines)
        );
      }

      const updatedContent = workingLines.join(newline);
      const updatedSizeBytes = Buffer.byteLength(updatedContent, "utf8");

      if (updatedSizeBytes > MAX_FILE_BYTES) {
        return {
          success: false,
          error: {
            code: "INVALID_PARAM",
            message: "Resulting file content exceeds maximum allowed size of 10 MB.",
          },
          metadata: { durationMs: Date.now() - startTime },
        };
      }

      // Persist modified content to Cloudflare R2 on the exact same storage key
      await uploadToR2({
        userId: context.userId,
        sessionId: context.sessionId,
        filename: targetStorageFilename,
        content: updatedContent,
        contentType: fileMimeType,
      });

      // Update SessionFile record in DB
      if (filePublicId) {
        await db.sessionFile.update({
          where: { publicId: filePublicId },
          data: {
            sizeBytes: BigInt(updatedSizeBytes),
            source: "tool",
          },
        });
      }

      const proxyUrl = `/api/v1/chats/${context.sessionId}/files/${filePublicId || targetStorageFilename}`;

      return {
        success: true,
        data: {
          id: filePublicId,
          filename: targetStorageFilename,
          displayName: safeFilename,
          mimeType: fileMimeType,
          sizeBytes: updatedSizeBytes,
          linesChanged: {
            added: totalAdded,
            removed: totalRemoved,
          },
          diff: diffChunks.join("\n\n"),
          totalLines: workingLines.length,
          url: proxyUrl,
        },
        metadata: {
          durationMs: Date.now() - startTime,
          provider: "cloudflare-r2",
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: {
          code: "STORAGE_ERROR",
          message: `Failed to edit file '${safeFilename}': ${(err as Error)?.message || "Internal error"}`,
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }
  },
};
