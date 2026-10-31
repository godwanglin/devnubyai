import PptxGenJS from "pptxgenjs";
import { db } from "../db";
import { uploadToR2 } from "../storage/r2";
import { MAX_FILE_BYTES } from "../files/policy";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";

export interface PresentationSlide {
  title?: string;
  content?: string;
  bullets?: string[];
  notes?: string;
  background?: string; // hex color without #
  layout?: "title" | "content" | "title_only" | "blank";
}

export interface CreatePresentationParams {
  filename: string;
  title?: string;
  subtitle?: string;
  author?: string;
  slides: PresentationSlide[];
}

export interface CreatePresentationData {
  id?: string;
  key: string;
  filename: string;
  displayName: string;
  sizeBytes: number;
  mimeType: string;
  slideCount: number;
  url: string;
}

const MIME_PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const createPresentationTool: ToolDefinition<
  CreatePresentationParams,
  CreatePresentationData
> = {
  name: "create_presentation",
  description:
    "Creates a polished, real binary Microsoft PowerPoint (.pptx) presentation with support for title slides, content slides with bullet points, speaker notes, and custom slide backgrounds. Perfect for generating pitch decks, project proposals, reports, training materials, and meeting presentations. The generated file is saved directly to session storage for instant preview and download.",
  parameters: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description:
          "The desired filename ending with .pptx (e.g. Pitch_Deck.pptx, Quarterly_Report.pptx, Project_Proposal.pptx).",
        required: true,
      },
      title: {
        type: "string",
        description: "Optional presentation title displayed on the first slide.",
      },
      subtitle: {
        type: "string",
        description: "Optional subtitle for the title slide.",
      },
      author: {
        type: "string",
        description: "Optional author name for presentation metadata.",
      },
      slides: {
        type: "array",
        description:
          "Array of slide definitions. Each slide can contain a title, bullet points, body text, and optional speaker notes.",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Slide title.",
            },
            content: {
              type: "string",
              description: "Optional body text or paragraph for the slide.",
            },
            bullets: {
              type: "array",
              items: { type: "string" },
              description: "Array of bullet point strings.",
            },
            notes: {
              type: "string",
              description: "Optional speaker notes for the slide.",
            },
            background: {
              type: "string",
              description: "Hex color (without #) for slide background (e.g. '1E293B').",
            },
            layout: {
              type: "string",
              enum: ["title", "content", "title_only", "blank"],
              description: "Slide layout type.",
            },
          },
        },
        required: true,
      },
    },
    required: ["filename", "slides"],
  },
  execute: async (
    params: CreatePresentationParams,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<CreatePresentationData>> => {
    const startTime = Date.now();
    let filename = (params.filename || "").trim().replace(/[.\s]+$/, "");

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

    if (!filename.toLowerCase().endsWith(".pptx")) {
      filename = `${filename}.pptx`;
    }

    if (!params.slides || !Array.isArray(params.slides) || params.slides.length === 0) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAM",
          message: "At least one slide is required to create a presentation.",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    try {
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_16x9";
      pptx.author = params.author || "Devnuby AI";
      pptx.company = "Devnuby AI";
      pptx.subject = params.title || "Presentation";
      pptx.title = params.title || filename;

      const titleBg = "1E293B"; // Slate-800
      const accentColor = "3B82F6"; // Blue-500

      // 1. Title Slide (if title provided or first slide is title layout)
      if (params.title) {
        const titleSlide = pptx.addSlide();
        titleSlide.background = { color: titleBg };
        titleSlide.addText(params.title, {
          x: 0.5,
          y: 1.5,
          w: 9,
          h: 1.5,
          fontSize: 40,
          bold: true,
          color: "FFFFFF",
          align: "center",
          valign: "middle",
        });

        if (params.subtitle) {
          titleSlide.addText(params.subtitle, {
            x: 0.5,
            y: 3.2,
            w: 9,
            h: 0.8,
            fontSize: 20,
            color: "94A3B8", // Slate-400
            align: "center",
            valign: "middle",
          });
        }

        if (params.author) {
          titleSlide.addText(params.author, {
            x: 0.5,
            y: 4.5,
            w: 9,
            h: 0.5,
            fontSize: 14,
            color: "64748B", // Slate-500
            align: "center",
          });
        }
      }

      // 2. Content Slides
      for (const slideDef of params.slides) {
        const slide = pptx.addSlide();
        const layout = slideDef.layout || "content";

        if (slideDef.background) {
          slide.background = { color: slideDef.background };
        }

        // Title
        if (slideDef.title) {
          slide.addText(slideDef.title, {
            x: 0.5,
            y: 0.4,
            w: 9,
            h: 0.8,
            fontSize: 28,
            bold: true,
            color: "1E293B", // Slate-800
            align: "left",
          });

          // Accent underline
          slide.addShape(pptx.ShapeType.rect, {
            x: 0.5,
            y: 1.25,
            w: 2.5,
            h: 0.06,
            fill: { color: accentColor },
          });
        }

        // Body text
        let currentY = 1.5;
        if (slideDef.content) {
          slide.addText(slideDef.content, {
            x: 0.5,
            y: currentY,
            w: 9,
            h: 1.2,
            fontSize: 16,
            color: "334155", // Slate-700
            align: "left",
            valign: "top",
          });
          currentY += 1.3;
        }

        // Bullet points
        if (slideDef.bullets && slideDef.bullets.length > 0) {
          const bulletText = slideDef.bullets.map((b) => ({
            text: b,
            options: { fontSize: 16, color: "334155", bullet: { type: "bullet" as const } },
          }));

          slide.addText(bulletText, {
            x: 0.5,
            y: currentY,
            w: 9,
            h: 4 - currentY,
            fontSize: 16,
            color: "334155",
            align: "left",
            valign: "top",
          });
        }

        // Speaker notes
        if (slideDef.notes) {
          slide.addNotes(slideDef.notes);
        }
      }

      // Generate binary buffer
      const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

      if (buffer.length > MAX_FILE_BYTES) {
        return {
          success: false,
          error: {
            code: "INVALID_PARAM",
            message: "Generated presentation exceeds maximum allowed size of 10 MB.",
          },
          metadata: { durationMs: Date.now() - startTime },
        };
      }

      // Upload to R2
      const uploaded = await uploadToR2({
        userId: context.userId,
        sessionId: context.sessionId,
        filename,
        content: buffer,
        contentType: MIME_PPTX,
      });

      // Record in DB
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
          slideCount: params.slides.length + (params.title ? 1 : 0),
          url: proxyUrl,
        },
        metadata: {
          durationMs: Date.now() - startTime,
          provider: "pptxgenjs",
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        success: false,
        error: {
          code: "STORAGE_ERROR",
          message: `Failed to generate PowerPoint presentation: ${message}`,
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }
  },
};
