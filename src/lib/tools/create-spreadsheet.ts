import ExcelJS from "exceljs";
import { db } from "../db";
import { uploadToR2 } from "../storage/r2";
import { MAX_FILE_BYTES } from "../files/policy";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";

export interface SpreadsheetColumnDef {
  header?: string;
  key?: string;
  width?: number;
}

export interface SpreadsheetCellFormula {
  formula: string;
  result?: string | number;
}

export type SpreadsheetCellValue =
  | string
  | number
  | boolean
  | Date
  | SpreadsheetCellFormula
  | null
  | undefined;

export interface SpreadsheetSheetDef {
  name: string;
  headers?: string[];
  columns?: SpreadsheetColumnDef[];
  data?: SpreadsheetCellValue[][];
  autoWidth?: boolean;
}

export interface CreateSpreadsheetParams {
  filename: string;
  sheets: SpreadsheetSheetDef[];
}

export interface CreateSpreadsheetData {
  id?: string;
  key: string;
  filename: string;
  displayName: string;
  sizeBytes: number;
  mimeType: string;
  sheetCount: number;
  rowCount: number;
  url: string;
}

const MIME_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const createSpreadsheetTool: ToolDefinition<
  CreateSpreadsheetParams,
  CreateSpreadsheetData
> = {
  name: "create_spreadsheet",
  description:
    "Creates a polished, real binary Microsoft Excel (.xlsx) spreadsheet with one or more sheets, styled headers, custom column widths, and optional Excel formulas (e.g. '=SUM(B2:B10)'). Saves the file to session storage so the user can preview, interact with, and download it in the files panel.",
  parameters: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description:
          "The desired filename ending with .xlsx (e.g. financial_report.xlsx, budget_plan.xlsx, sales_q3.xlsx).",
        required: true,
      },
      sheets: {
        type: "array",
        description:
          "Array of sheet configurations to create within the workbook.",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The sheet tab name (e.g. 'Summary', 'January').",
              required: true,
            },
            headers: {
              type: "array",
              description: "Optional array of string header labels for row 1.",
              items: { type: "string" },
            },
            columns: {
              type: "array",
              description: "Optional column definitions with custom widths.",
              items: {
                type: "object",
                properties: {
                  header: { type: "string" },
                  key: { type: "string" },
                  width: { type: "number" },
                },
              },
            },
            data: {
              type: "array",
              description:
                "2D array of rows and cell values. Cell values can be strings, numbers, booleans, or objects with { formula: '=SUM(...)' }.",
              items: {
                type: "array",
              },
            },
            autoWidth: {
              type: "boolean",
              description:
                "Automatically compute reasonable column widths based on content (default: true).",
            },
          },
          required: ["name"],
        },
        required: true,
      },
    },
    required: ["filename", "sheets"],
  },
  execute: async (
    params: CreateSpreadsheetParams,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<CreateSpreadsheetData>> => {
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

    if (!filename.toLowerCase().endsWith(".xlsx")) {
      filename = `${filename}.xlsx`;
    }

    if (!params.sheets || !Array.isArray(params.sheets) || params.sheets.length === 0) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAM",
          message: "At least one sheet definition is required to create a spreadsheet.",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Devnuby AI";
      workbook.created = new Date();
      workbook.modified = new Date();

      let totalRowCount = 0;

      for (const sheetDef of params.sheets) {
        const sheetName = (sheetDef.name || "Sheet").slice(0, 31); // Excel limits sheet names to 31 chars
        const worksheet = workbook.addWorksheet(sheetName, {
          views: [{ state: "normal" }],
        });

        // 1. Column definitions
        if (sheetDef.columns && sheetDef.columns.length > 0) {
          worksheet.columns = sheetDef.columns.map((c) => ({
            header: c.header,
            key: c.key,
            width: c.width || 15,
          }));
        }

        // 2. Headers (if columns not already providing them)
        if (sheetDef.headers && sheetDef.headers.length > 0 && (!sheetDef.columns || sheetDef.columns.length === 0)) {
          const headerRow = worksheet.addRow(sheetDef.headers);
          headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
          headerRow.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF1E293B" }, // Slate-800
          };
          headerRow.alignment = { vertical: "middle", horizontal: "left" };
          headerRow.height = 24;
          totalRowCount++;
        } else if (worksheet.rowCount > 0) {
          // Style row 1 if columns added header
          const firstRow = worksheet.getRow(1);
          firstRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
          firstRow.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF1E293B" },
          };
          firstRow.height = 24;
          totalRowCount++;
        }

        // 3. Rows & Cells
        if (sheetDef.data && Array.isArray(sheetDef.data)) {
          for (const rowData of sheetDef.data) {
            if (!Array.isArray(rowData)) continue;

            const parsedRowValues = rowData.map((cell) => {
              if (cell && typeof cell === "object" && "formula" in cell) {
                const formulaObj = cell as SpreadsheetCellFormula;
                const cleanFormula = formulaObj.formula.startsWith("=")
                  ? formulaObj.formula.slice(1)
                  : formulaObj.formula;
                return {
                  formula: cleanFormula,
                  result: formulaObj.result,
                };
              }
              return cell;
            });

            worksheet.addRow(parsedRowValues);
            totalRowCount++;
          }
        }

        // 4. Auto-calculate column widths if requested or default
        const shouldAutoWidth = sheetDef.autoWidth !== false;
        if (shouldAutoWidth && (!sheetDef.columns || sheetDef.columns.length === 0)) {
          worksheet.columns.forEach((column) => {
            let maxLen = 10;
            if (column.values) {
              column.values.forEach((v) => {
                if (v != null) {
                  const text = typeof v === "object" && "formula" in v ? String(v.formula) : String(v);
                  if (text.length > maxLen) {
                    maxLen = Math.min(text.length, 50);
                  }
                }
              });
            }
            column.width = maxLen + 3;
          });
        }
      }

      // Generate binary buffer
      const buffer = await workbook.xlsx.writeBuffer();
      const nodeBuffer = Buffer.from(buffer);

      if (nodeBuffer.length > MAX_FILE_BYTES) {
        return {
          success: false,
          error: {
            code: "INVALID_PARAM",
            message: "Generated spreadsheet exceeds maximum allowed size of 10 MB.",
          },
          metadata: { durationMs: Date.now() - startTime },
        };
      }

      // Upload to R2
      const uploaded = await uploadToR2({
        userId: context.userId,
        sessionId: context.sessionId,
        filename,
        content: nodeBuffer,
        contentType: MIME_XLSX,
      });

      // Track in DB
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
          sheetCount: params.sheets.length,
          rowCount: totalRowCount,
          url: proxyUrl,
        },
        metadata: {
          durationMs: Date.now() - startTime,
          provider: "exceljs",
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        success: false,
        error: {
          code: "STORAGE_ERROR",
          message: `Failed to generate spreadsheet: ${message}`,
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }
  },
};
