import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
} from "docx";
import { db } from "../db";
import { uploadToR2 } from "../storage/r2";
import { MAX_FILE_BYTES } from "../files/policy";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";

export interface DocumentParagraphSection {
  type: "paragraph";
  text: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right" | "justify";
}

export interface DocumentHeadingSection {
  type: "heading";
  text: string;
  level: 1 | 2 | 3 | 4;
}

export interface DocumentBulletListSection {
  type: "bullet_list";
  items: string[];
}

export interface DocumentNumberedListSection {
  type: "numbered_list";
  items: string[];
}

export interface DocumentTableSection {
  type: "table";
  headers?: string[];
  rows: (string | number)[][];
}

export interface DocumentPageBreakSection {
  type: "page_break";
}

export type DocumentSection =
  | DocumentParagraphSection
  | DocumentHeadingSection
  | DocumentBulletListSection
  | DocumentNumberedListSection
  | DocumentTableSection
  | DocumentPageBreakSection;

export interface CreateDocumentParams {
  filename: string;
  title?: string;
  subtitle?: string;
  sections: DocumentSection[];
}

export interface CreateDocumentData {
  id?: string;
  key: string;
  filename: string;
  displayName: string;
  sizeBytes: number;
  mimeType: string;
  sectionsCount: number;
  url: string;
}

const MIME_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function getAlignment(align?: string): (typeof AlignmentType)[keyof typeof AlignmentType] {
  switch (align) {
    case "center":
      return AlignmentType.CENTER;
    case "right":
      return AlignmentType.RIGHT;
    case "justify":
      return AlignmentType.JUSTIFIED;
    case "left":
    default:
      return AlignmentType.LEFT;
  }
}

function getHeadingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  switch (level) {
    case 1:
      return HeadingLevel.HEADING_1;
    case 2:
      return HeadingLevel.HEADING_2;
    case 3:
      return HeadingLevel.HEADING_3;
    case 4:
    default:
      return HeadingLevel.HEADING_4;
  }
}

export const createDocumentTool: ToolDefinition<
  CreateDocumentParams,
  CreateDocumentData
> = {
  name: "create_document",
  description:
    "Creates a beautifully formatted binary Microsoft Word (.docx) document with support for document titles, subtitles, hierarchical headings, styled paragraphs, bullet lists, numbered lists, and styled data tables. Perfect for generating resumes/CVs, cover letters, formal proposals, memos, contracts, and reports. The generated file is saved directly to session storage for instant preview and download.",
  parameters: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description:
          "The desired filename ending with .docx (e.g. CV_Aiden.docx, Project_Proposal.docx, Formal_Letter.docx).",
        required: true,
      },
      title: {
        type: "string",
        description:
          "Optional prominent main title displayed at the top of the document.",
      },
      subtitle: {
        type: "string",
        description:
          "Optional subtitle or metadata displayed under the main title.",
      },
      sections: {
        type: "array",
        description:
          "Ordered array of document content sections (headings, paragraphs, bullet lists, numbered lists, tables, or page breaks).",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: [
                "heading",
                "paragraph",
                "bullet_list",
                "numbered_list",
                "table",
                "page_break",
              ],
              description: "The type of document block.",
              required: true,
            },
            level: {
              type: "number",
              description: "Heading level (1 to 4) when type is 'heading'.",
            },
            text: {
              type: "string",
              description: "Text content for 'heading' or 'paragraph'.",
            },
            bold: {
              type: "boolean",
              description: "Whether paragraph text is bold.",
            },
            italic: {
              type: "boolean",
              description: "Whether paragraph text is italic.",
            },
            align: {
              type: "string",
              enum: ["left", "center", "right", "justify"],
              description: "Text alignment.",
            },
            items: {
              type: "array",
              items: { type: "string" },
              description: "Array of string items for bullet_list or numbered_list.",
            },
            headers: {
              type: "array",
              items: { type: "string" },
              description: "Column headers when type is 'table'.",
            },
            rows: {
              type: "array",
              items: { type: "array" },
              description: "2D array of row cells when type is 'table'.",
            },
          },
          required: ["type"],
        },
        required: true,
      },
    },
    required: ["filename", "sections"],
  },
  execute: async (
    params: CreateDocumentParams,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<CreateDocumentData>> => {
    const startTime = Date.now();
    let filename = (params.filename || "").trim().replace(/[.\s]+$/, "");

    if (!filename) {
      return {
        success: false,
        error: { code: "INVALID_PARAM", message: "Missing required parameter 'filename'." },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    if (filename.includes("..") || /[\\/\0]/.test(filename)) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAM",
          message: "Filename contains unsafe or illegal characters.",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    if (!filename.toLowerCase().endsWith(".docx")) {
      filename = `${filename}.docx`;
    }

    if (!params.sections || !Array.isArray(params.sections) || params.sections.length === 0) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAM",
          message: "At least one section is required to create a document.",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    try {
      const docChildren: (Paragraph | Table)[] = [];

      // 1. Optional Title & Subtitle Header
      if (params.title) {
        docChildren.push(
          new Paragraph({
            text: params.title,
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 100 },
          })
        );
      }

      if (params.subtitle) {
        docChildren.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
            children: [
              new TextRun({
                text: params.subtitle,
                italics: true,
                color: "64748B",
                size: 22,
              }),
            ],
          })
        );
      }

      // 2. Iterate Sections
      for (const section of params.sections) {
        switch (section.type) {
          case "heading": {
            docChildren.push(
              new Paragraph({
                text: section.text || "",
                heading: getHeadingLevel(section.level || 2),
                spacing: { before: 240, after: 120 },
              })
            );
            break;
          }

          case "paragraph": {
            docChildren.push(
              new Paragraph({
                alignment: getAlignment(section.align),
                spacing: { after: 120, line: 276 },
                children: [
                  new TextRun({
                    text: section.text || "",
                    bold: section.bold,
                    italics: section.italic,
                    size: 24, // 12pt standard body
                  }),
                ],
              })
            );
            break;
          }

          case "bullet_list": {
            if (Array.isArray(section.items)) {
              for (const item of section.items) {
                docChildren.push(
                  new Paragraph({
                    bullet: { level: 0 },
                    spacing: { after: 80 },
                    children: [new TextRun({ text: item, size: 24 })],
                  })
                );
              }
            }
            break;
          }

          case "numbered_list": {
            if (Array.isArray(section.items)) {
              for (let i = 0; i < section.items.length; i++) {
                docChildren.push(
                  new Paragraph({
                    spacing: { after: 80 },
                    children: [
                      new TextRun({ text: `${i + 1}. `, bold: true, size: 24 }),
                      new TextRun({ text: section.items[i], size: 24 }),
                    ],
                  })
                );
              }
            }
            break;
          }

          case "table": {
            const tableRows: TableRow[] = [];

            // Header row
            if (section.headers && section.headers.length > 0) {
              const headerCells = section.headers.map(
                (h) =>
                  new TableCell({
                    shading: {
                      type: ShadingType.CLEAR,
                      fill: "1E293B", // Slate-800
                      color: "FFFFFF",
                    },
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: h,
                            bold: true,
                            color: "FFFFFF",
                            size: 22,
                          }),
                        ],
                      }),
                    ],
                  })
              );
              tableRows.push(new TableRow({ children: headerCells }));
            }

            // Data rows
            if (section.rows && Array.isArray(section.rows)) {
              for (const r of section.rows) {
                if (!Array.isArray(r)) continue;
                const dataCells = r.map(
                  (c) =>
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [new TextRun({ text: String(c ?? ""), size: 22 })],
                        }),
                      ],
                    })
                );
                tableRows.push(new TableRow({ children: dataCells }));
              }
            }

            if (tableRows.length > 0) {
              docChildren.push(
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  borders: {
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
                    insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0" },
                    insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0" },
                  },
                  rows: tableRows,
                })
              );
            }
            break;
          }

          case "page_break": {
            docChildren.push(
              new Paragraph({
                pageBreakBefore: true,
              })
            );
            break;
          }
        }
      }

      const doc = new Document({
        creator: "Devnuby AI",
        title: params.title || filename,
        description: "Generated by Devnuby AI",
        sections: [
          {
            properties: {},
            children: docChildren,
          },
        ],
      });

      // Package to binary buffer
      const buffer = await Packer.toBuffer(doc);
      if (buffer.length > MAX_FILE_BYTES) {
        return {
          success: false,
          error: {
            code: "INVALID_PARAM",
            message: "Generated document exceeds maximum allowed size of 10 MB.",
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
        contentType: MIME_DOCX,
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
          sectionsCount: params.sections.length,
          url: proxyUrl,
        },
        metadata: {
          durationMs: Date.now() - startTime,
          provider: "docx",
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        success: false,
        error: {
          code: "STORAGE_ERROR",
          message: `Failed to generate Word document: ${message}`,
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }
  },
};
