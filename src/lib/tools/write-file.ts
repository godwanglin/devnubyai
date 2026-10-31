import { db } from "../db";
import { uploadToR2 } from "../storage/r2";
import {
  MAX_FILE_BYTES,
  BLOCKED_EXTENSIONS,
  MIME_BY_EXTENSION,
  getFileExtension,
} from "../files/policy";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";

export interface WriteFileParams {
  filename: string;
  content: string;
  mimeType?: string;
}

export interface WriteFileData {
  id?: string;
  key: string;
  filename: string;
  displayName: string;
  sizeBytes: number;
  mimeType: string;
  linesChanged?: {
    added: number;
    removed: number;
  };
  url: string;
}

export const writeFileTool: ToolDefinition<WriteFileParams, WriteFileData> = {
  name: "write_file",
  description:
    "Saves a generated document, web page (.html), markdown report (.md), dataset (.csv/.json), diagram (.svg/.mmd), or source code file into the user's session storage so the user can preview and download it in the right-hand files panel.",
  parameters: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description:
          "The desired filename with extension (e.g. landing-page.html, report.md, data.csv, architecture.mmd, script.py).",
        required: true,
      },
      content: {
        type: "string",
        description: "The complete UTF-8 content to write into the file.",
        required: true,
      },
      mimeType: {
        type: "string",
        description: "Optional MIME type override.",
      },
    },
    required: ["filename", "content"],
  },
  execute: async (
    params: WriteFileParams,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<WriteFileData>> => {
    const startTime = Date.now();
    const filename = (params.filename || "").trim().replace(/[.\s]+$/, "");

    if (!filename || filename.includes("..") || /[\\/\0]/.test(filename)) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAM",
          message: "Filename contains unsafe or illegal characters.",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    const extension = getFileExtension(filename);

    if (BLOCKED_EXTENSIONS.has(extension)) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAM",
          message: `Extension '${extension}' is an executable or installer binary and is not permitted.`,
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    const content = params.content || "";
    const sizeBytes = Buffer.byteLength(content, "utf8");
    if (sizeBytes > MAX_FILE_BYTES) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAM",
          message: "File content exceeds maximum allowed size of 10 MB.",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    try {
      let mimeType = params.mimeType || MIME_BY_EXTENSION[extension] || "text/plain";
      if (extension === ".svg" || mimeType.includes("svg")) {
        mimeType = "text/plain";
      }

      const uploaded = await uploadToR2({
        userId: context.userId,
        sessionId: context.sessionId,
        filename,
        content,
        contentType: mimeType,
      });

      const sessionRow = await db.chatSession.findUnique({
        where: { publicId: context.sessionId },
        select: { id: true, publicId: true, userId: true },
      });

      let filePublicId: string | undefined;
      if (sessionRow) {
        const savedFile = await db.sessionFile.upsert({
          where: {
            sessionId_filename: {
              sessionId: sessionRow.id,
              filename: uploaded.filename,
            },
          },
          update: {
            storageKey: uploaded.key,
            mimeType: uploaded.contentType,
            sizeBytes: BigInt(uploaded.sizeBytes),
            source: "tool",
          },
          create: {
            userId: sessionRow.userId,
            sessionId: sessionRow.id,
            filename: uploaded.filename,
            storageKey: uploaded.key,
            mimeType: uploaded.contentType,
            sizeBytes: BigInt(uploaded.sizeBytes),
            source: "tool",
          },
          select: { publicId: true },
        });
        filePublicId = savedFile.publicId;
      }

      const proxyUrl =
        sessionRow && filePublicId
          ? `/api/v1/chats/${sessionRow.publicId}/files/${filePublicId}`
          : uploaded.url;

      return {
        success: true,
        data: {
          id: filePublicId,
          key: uploaded.key,
          filename: uploaded.filename,
          displayName: filename,
          sizeBytes: uploaded.sizeBytes,
          mimeType: uploaded.contentType,
          linesChanged: {
            added: content.split("\n").length,
            removed: 0,
          },
          url: proxyUrl,
        },
        metadata: { durationMs: Date.now() - startTime, provider: "cloudflare-r2" },
      };
    } catch {
      return {
        success: false,
        error: {
          code: "STORAGE_ERROR",
          message: "Failed to persist file into session storage.",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }
  },
};
