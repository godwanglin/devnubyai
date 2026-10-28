import { downloadFromR2, sanitizeKey } from "../storage/r2";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15MB

function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length < 8) return null;

  // PNG magic: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }

  // JPEG magic: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // WebP magic: RIFF....WEBP
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  // GIF magic: GIF87a / GIF89a
  if (buffer.toString("ascii", 0, 3) === "GIF") {
    return "image/gif";
  }

  return null;
}

export interface VisionToolParams {
  filename: string;
  instruction?: string;
}

export interface VisionToolData {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  base64Thumbnail?: string;
  instruction: string;
  readyForModel: boolean;
}

export const visionTool: ToolDefinition<VisionToolParams, VisionToolData> = {
  name: "vision_tool",
  description:
    "Validates and inspects an image stored in user session storage to prepare it for visual AI analysis.",
  parameters: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "The name of the image file in the current session storage (e.g. screenshot.png).",
        required: true,
      },
      instruction: {
        type: "string",
        description: "Specific visual analysis instructions, e.g. 'Read the text in the table' or 'Describe the diagram'.",
      },
    },
    required: ["filename"],
  },
  execute: async (
    params: VisionToolParams,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<VisionToolData>> => {
    const startTime = Date.now();
    const rawFilename = (params.filename || "").trim();

    if (!rawFilename || rawFilename.includes("..") || /[\\/\0]/.test(rawFilename)) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAM",
          message: "Invalid or unsafe image filename provided.",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    const safeFilename = sanitizeKey(rawFilename);

    try {
      const downloaded = await downloadFromR2({
        userId: context.userId,
        sessionId: context.sessionId,
        filename: safeFilename,
        maxBytes: MAX_IMAGE_BYTES,
      });

      const detectedMime = detectImageMime(downloaded.content);
      if (!detectedMime) {
        return {
          success: false,
          error: {
            code: "INVALID_PARAM",
            message: `File '${safeFilename}' is not a supported image format (only PNG, JPEG, WebP, GIF are supported).`,
          },
          metadata: { durationMs: Date.now() - startTime },
        };
      }

      // Prepare a base64 string for vision inspection: only encode head for preview to conserve RAM
      const previewSlice = downloaded.content.subarray(0, 1024);
      const base64Preview = previewSlice.toString("base64");

      return {
        success: true,
        data: {
          filename: safeFilename,
          mimeType: detectedMime,
          sizeBytes: downloaded.sizeBytes,
          base64Thumbnail: `data:${detectedMime};base64,${base64Preview.slice(0, 300)}...`,
          instruction: params.instruction || "Analyze this image in detail.",
          readyForModel: true,
        },
        metadata: {
          durationMs: Date.now() - startTime,
          provider: "vision-pipeline",
        },
      };
    } catch (err: any) {
      const isNotFound = err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404;
      return {
        success: false,
        error: {
          code: isNotFound ? "NOT_FOUND" : "STORAGE_ERROR",
          message: isNotFound
            ? `Image '${safeFilename}' was not found in session storage.`
            : "Failed to process image from storage.",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }
  },
};
