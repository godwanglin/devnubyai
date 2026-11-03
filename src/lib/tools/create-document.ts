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
  Header,
  Footer,
  PageNumber,
  PageOrientation,
  ExternalHyperlink,
} from "docx";
import { db } from "../db";
import { uploadToR2 } from "../storage/r2";
import { checkAgentUploadQuota } from "../files/upload-quota";
import { MAX_FILE_BYTES } from "../files/policy";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";

export interface DocumentInlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  color?: string; // Hex color e.g. "0F172A", "2563EB"
  size?: number; // Half-points (e.g. 24 = 12pt)
  link?: string; // External hyperlink URL
}

export interface DocumentParagraphSection {
  type: "paragraph";
  text?: string;
  runs?: DocumentInlineRun[];
  bold?: boolean;
  italic?: boolean;
  color?: string;
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
  zebra?: boolean;
}

export interface DocumentCalloutSection {
  type: "callout";
  title?: string;
  text: string;
  variant?: "info" | "warning" | "success" | "neutral";
}

export interface DocumentDividerSection {
  type: "divider";
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
  | DocumentCalloutSection
  | DocumentDividerSection
  | DocumentPageBreakSection;

export interface CreateDocumentParams {
  filename: string;
  title?: string;
  subtitle?: string;
  headerText?: string;
  footerText?: string;
  showPageNumbers?: boolean;
  orientation?: "portrait" | "landscape";
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

function sanitizeHex(raw?: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/^#/, "").trim();
  return /^[0-9a-fA-F]{6}$/.test(cleaned) ? cleaned.toUpperCase() : undefined;
}

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

function buildRuns(section: DocumentParagraphSection): (TextRun | ExternalHyperlink)[] {
  if (Array.isArray(section.runs) && section.runs.length > 0) {
    return section.runs.map((r) => {
      const textRun = new TextRun({
        text: r.text || "",
        bold: r.bold,
        italics: r.italic,
        color: sanitizeHex(r.color),
        size: r.size ?? 24,
      });
      if (r.link && /^https?:\/\//i.test(r.link.trim())) {
        return new ExternalHyperlink({
          children: [
            new TextRun({
              text: r.text || r.link,
              bold: r.bold,
              italics: r.italic,
              color: sanitizeHex(r.color) || "2563EB",
              underline: {},
              size: r.size ?? 24,
            }),
          ],
          link: r.link.trim(),
        });
      }
      return textRun;
    });
  }

  return [
    new TextRun({
      text: section.text || "",
      bold: section.bold,
      italics: section.italic,
      color: sanitizeHex(section.color),
      size: 24, // 12pt standard body
    }),
  ];
}

/** Renders the document params into a .docx binary (no storage side effects). */
export async function buildDocumentBuffer(
  params: CreateDocumentParams,
  filename: string
): Promise<Buffer> {
  const docChildren: (Paragraph | Table)[] = [];

  // 1. Optional Title & Subtitle Header
  if (params.title) {
    docChildren.push(
      new Paragraph({
        text: params.title,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 120 },
      })
    );
  }

  if (params.subtitle) {
    docChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 360 },
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
        const level = section.level || 2;
        const headingColor = level === 1 ? "0F172A" : level === 2 ? "1E3A8A" : "334155";
        docChildren.push(
          new Paragraph({
            heading: getHeadingLevel(level),
            spacing: { before: level === 1 ? 320 : 200, after: 120 },
            children: [
              new TextRun({
                text: section.text || "",
                bold: true,
                color: headingColor,
              }),
            ],
          })
        );
        break;
      }

      case "paragraph": {
        docChildren.push(
          new Paragraph({
            alignment: getAlignment(section.align),
            spacing: { after: 140, line: 280 },
            children: buildRuns(section),
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
                spacing: { after: 80, line: 260 },
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
                spacing: { after: 80, line: 260 },
                children: [
                  new TextRun({ text: `${i + 1}. `, bold: true, color: "1E3A8A", size: 24 }),
                  new TextRun({ text: section.items[i], size: 24 }),
                ],
              })
            );
          }
        }
        break;
      }

      case "callout": {
        const variant = section.variant || "info";
        const palette: Record<string, { bg: string; border: string; titleColor: string }> = {
          info: { bg: "F1F5F9", border: "2563EB", titleColor: "1E40AF" },
          warning: { bg: "FEF3C7", border: "D97706", titleColor: "92400E" },
          success: { bg: "DCFCE7", border: "16A34A", titleColor: "166534" },
          neutral: { bg: "F8FAFC", border: "64748B", titleColor: "334155" },
        };
        const theme = palette[variant] ?? palette.info;

        const calloutParagraphs: Paragraph[] = [];
        if (section.title) {
          calloutParagraphs.push(
            new Paragraph({
              spacing: { after: 80 },
              children: [
                new TextRun({
                  text: section.title,
                  bold: true,
                  size: 22,
                  color: theme.titleColor,
                }),
              ],
            })
          );
        }
        calloutParagraphs.push(
          new Paragraph({
            spacing: { after: 40, line: 260 },
            children: [
              new TextRun({
                text: section.text || "",
                italics: true,
                size: 22,
                color: "1E293B",
              }),
            ],
          })
        );

        docChildren.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE },
              bottom: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE },
              left: { style: BorderStyle.SINGLE, size: 24, color: theme.border },
              insideHorizontal: { style: BorderStyle.NONE },
              insideVertical: { style: BorderStyle.NONE },
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    shading: { type: ShadingType.CLEAR, fill: theme.bg },
                    margins: { top: 140, bottom: 140, left: 200, right: 200 },
                    children: calloutParagraphs,
                  }),
                ],
              }),
            ],
          })
        );
        docChildren.push(new Paragraph({ spacing: { after: 120 } }));
        break;
      }

      case "divider": {
        docChildren.push(
          new Paragraph({
            spacing: { before: 180, after: 180 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
            },
          })
        );
        break;
      }

      case "table": {
        const tableRows: TableRow[] = [];
        const isZebra = section.zebra !== false;

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
                margins: { top: 120, bottom: 120, left: 140, right: 140 },
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
          tableRows.push(new TableRow({ tableHeader: true, children: headerCells }));
        }

        // Data rows
        if (section.rows && Array.isArray(section.rows)) {
          for (let rowIndex = 0; rowIndex < section.rows.length; rowIndex++) {
            const r = section.rows[rowIndex];
            if (!Array.isArray(r)) continue;
            const rowShading = isZebra && rowIndex % 2 === 1 ? "F8FAFC" : "FFFFFF";
            const dataCells = r.map(
              (c) =>
                new TableCell({
                  shading: { type: ShadingType.CLEAR, fill: rowShading },
                  margins: { top: 100, bottom: 100, left: 140, right: 140 },
                  children: [
                    new Paragraph({
                      children: [new TextRun({ text: String(c ?? ""), size: 22, color: "1E293B" })],
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
                top: { style: BorderStyle.SINGLE, size: 6, color: "94A3B8" },
                bottom: { style: BorderStyle.SINGLE, size: 6, color: "94A3B8" },
                left: { style: BorderStyle.NONE },
                right: { style: BorderStyle.NONE },
                insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
                insideVertical: { style: BorderStyle.NONE },
              },
              rows: tableRows,
            })
          );
          docChildren.push(new Paragraph({ spacing: { after: 160 } }));
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

  // Headers & Footers
  const headersConfig: { default?: Header } = {};
  if (params.headerText) {
    headersConfig.default = new Header({
      children: [
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            new TextRun({
              text: params.headerText,
              size: 18,
              color: "94A3B8",
              italics: true,
            }),
          ],
        }),
      ],
    });
  }

  const footersConfig: { default?: Footer } = {};
  const shouldShowPages = params.showPageNumbers ?? Boolean(params.footerText);
  if (params.footerText || shouldShowPages) {
    const footerChildren: TextRun[] = [];
    if (params.footerText) {
      footerChildren.push(
        new TextRun({
          text: params.footerText,
          size: 18,
          color: "94A3B8",
        })
      );
    }
    if (shouldShowPages) {
      if (params.footerText) {
        footerChildren.push(new TextRun({ text: "  |  Page ", size: 18, color: "CBD5E1" }));
      } else {
        footerChildren.push(new TextRun({ text: "Page ", size: 18, color: "94A3B8" }));
      }
      footerChildren.push(
        new TextRun({
          children: [PageNumber.CURRENT],
          size: 18,
          color: "64748B",
        })
      );
      footerChildren.push(new TextRun({ text: " of ", size: 18, color: "94A3B8" }));
      footerChildren.push(
        new TextRun({
          children: [PageNumber.TOTAL_PAGES],
          size: 18,
          color: "64748B",
        })
      );
    }

    footersConfig.default = new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: footerChildren,
        }),
      ],
    });
  }

  const doc = new Document({
    creator: "Devnuby AI",
    title: params.title || filename,
    description: "Generated by Devnuby AI",
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation:
                params.orientation === "landscape"
                  ? PageOrientation.LANDSCAPE
                  : PageOrientation.PORTRAIT,
            },
          },
        },
        headers: headersConfig,
        footers: footersConfig,
        children: docChildren,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

export const createDocumentTool: ToolDefinition<
  CreateDocumentParams,
  CreateDocumentData
> = {
  name: "create_document",
  description:
    "Creates a beautifully formatted binary Microsoft Word (.docx) document. Supports title, subtitle, custom headers/footers, automated page numbers, hierarchical headings (H1-H4), styled paragraphs with rich inline runs & hyperlinks, bullet & numbered lists, callout highlight boxes, zebra tables, horizontal dividers, and deliberate page breaks. Consult the 'docx' skill (`load_skill`) for professional layouts (CVs, cover letters, formal proposals, memos, contracts, and business reports).",
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
      headerText: {
        type: "string",
        description:
          "Optional small header text displayed at the top of every page (e.g. 'Acme Corp — Proposal').",
      },
      footerText: {
        type: "string",
        description:
          "Optional footer text displayed at the bottom of every page (e.g. 'Confidential').",
      },
      showPageNumbers: {
        type: "boolean",
        description:
          "Whether to show dynamic 'Page X of Y' numbers in the page footer. Defaults to true if footerText is set.",
      },
      orientation: {
        type: "string",
        enum: ["portrait", "landscape"],
        description:
          "Page orientation. Defaults to 'portrait'. Use 'landscape' for wide tables or dashboards.",
      },
      sections: {
        type: "array",
        description:
          "Ordered array of document content sections (heading, paragraph, bullet_list, numbered_list, table, callout, divider, page_break).",
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
                "callout",
                "divider",
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
              description: "Text content for 'heading', 'paragraph', or 'callout'.",
            },
            title: {
              type: "string",
              description: "Optional title for 'callout' box.",
            },
            variant: {
              type: "string",
              enum: ["info", "warning", "success", "neutral"],
              description: "Accent color variant for 'callout' box.",
            },
            bold: {
              type: "boolean",
              description: "Whether paragraph text is bold.",
            },
            italic: {
              type: "boolean",
              description: "Whether paragraph text is italic.",
            },
            color: {
              type: "string",
              description: "Hex color for paragraph text (e.g. '0F172A', '#2563EB').",
            },
            align: {
              type: "string",
              enum: ["left", "center", "right", "justify"],
              description: "Text alignment.",
            },
            runs: {
              type: "array",
              description:
                "Optional rich text runs for paragraph (mix bold, italic, color, and hyperlinks within one paragraph).",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  bold: { type: "boolean" },
                  italic: { type: "boolean" },
                  color: { type: "string" },
                  size: { type: "number" },
                  link: { type: "string" },
                },
              },
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
            zebra: {
              type: "boolean",
              description: "Whether to alternate row shading for table readability.",
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
      const buffer = await buildDocumentBuffer(params, filename);
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

      const quotaError = await checkAgentUploadQuota(context.userId, buffer.length);
      if (quotaError) {
        return {
          success: false,
          error: { code: "RATE_LIMITED", message: quotaError },
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
