import { db } from "../db";
import { uploadToR2 } from "../storage/r2";
import { checkAgentUploadQuota } from "../files/upload-quota";
import { MAX_FILE_BYTES } from "../files/policy";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";
import { executeImageGeneration } from "@/lib/images/executor";
import type { ImageAspectRatio } from "@/lib/images/post-process";

export interface GenerateImageParams {
  prompt: string;
  aspectRatio?: ImageAspectRatio;
  resolution?: string;
  transparentBackground?: boolean;
  filename?: string;
}

export interface GenerateImageData {
  id?: string;
  key: string;
  filename: string;
  displayName: string;
  sizeBytes: number;
  mimeType: string;
  url: string;
  width: number;
  height: number;
  prompt: string;
  modelUsed: string;
  gatewayUsed: string;
}

export const generateImageTool: ToolDefinition<
  GenerateImageParams,
  GenerateImageData
> = {
  name: "generate_image",
  description:
    "Generates a high-quality visual AI image based on a descriptive prompt using connected OAuth image models (Gemini Flash Image & Grok Imagine) with automatic cross-account and cross-provider fallback. Supports custom aspect ratios (1:1, 16:9, 9:16, 4:3, 3:4), custom resolutions, and automated transparent background removal (produces clean PNG alpha channel for logos, stickers, and isolated objects). The image is stored in session storage and immediately rendered in chat.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "Detailed visual description of the image to generate. Include style, subject, lighting, mood, colors, and composition.",
        required: true,
      },
      aspectRatio: {
        type: "string",
        enum: ["1:1", "16:9", "9:16", "4:3", "3:4"],
        description:
          "Desired aspect ratio. Defaults to '1:1' for square, '16:9' for widescreen/landscape, '9:16' for vertical/story/wallpaper.",
      },
      resolution: {
        type: "string",
        description:
          "Exact resolution dimensions (e.g. '1024x1024', '1344x768', '768x1344'). Overrides aspectRatio if provided.",
      },
      transparentBackground: {
        type: "boolean",
        description:
          "Set to true when the user asks for a transparent background, cutout, logo, icon, or isolated sticker without backdrop. Automatically executes chroma-key edge isolation to produce a true transparent RGBA PNG.",
      },
      filename: {
        type: "string",
        description:
          "Optional desired filename (e.g. 'cyberpunk_city.jpg' or 'app_logo.png'). If omitted, a descriptive name will be generated.",
      },
    },
    required: ["prompt"],
  },
  execute: async (
    params: GenerateImageParams,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<GenerateImageData>> => {
    const startTime = Date.now();
    const prompt = String(params?.prompt ?? "").trim();

    if (!prompt) {
      return {
        success: false,
        error: { code: "INVALID_PARAM", message: "Parameter 'prompt' is required." },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    try {
      // Execute multi-account & multi-provider image generation
      const result = await executeImageGeneration(prompt, {
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        transparentBackground: params.transparentBackground,
        signal: context.signal,
      });

      if (result.buffer.length > MAX_FILE_BYTES) {
        return {
          success: false,
          error: {
            code: "INVALID_PARAM",
            message: "Generated image exceeds maximum file size limit of 10 MB.",
          },
          metadata: { durationMs: Date.now() - startTime },
        };
      }

      // Check upload quota
      const quotaError = await checkAgentUploadQuota(context.userId, result.buffer.length);
      if (quotaError) {
        return {
          success: false,
          error: { code: "RATE_LIMITED", message: quotaError },
          metadata: { durationMs: Date.now() - startTime },
        };
      }

      // Filename resolution
      const ext = result.mimeType === "image/png" ? "png" : "jpg";
      let filename = (params.filename || "").trim().replace(/[.\s]+$/, "");
      if (!filename) {
        const slug = prompt
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .slice(0, 30)
          .replace(/^-|-$/g, "");
        filename = `generated-${slug || "image"}-${Date.now().toString().slice(-6)}.${ext}`;
      } else if (!filename.toLowerCase().endsWith(`.${ext}`)) {
        filename = `${filename}.${ext}`;
      }

      // Upload to Cloudflare R2
      const uploaded = await uploadToR2({
        userId: context.userId,
        sessionId: context.sessionId,
        filename,
        content: result.buffer,
        contentType: result.mimeType,
      });

      // Record in DB SessionFile
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
          url: proxyUrl,
          width: result.width,
          height: result.height,
          prompt,
          modelUsed: result.modelUsed,
          gatewayUsed: result.gatewayUsed,
        },
        metadata: {
          durationMs: Date.now() - startTime,
          provider: result.gatewayUsed,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        success: false,
        error: {
          code: "EXECUTION_ERROR",
          message: `Failed to generate image: ${message}`,
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }
  },
};
