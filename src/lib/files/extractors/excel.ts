import type { ExtractorResult } from "./types";

/**
 * Extracts tabular data from Excel spreadsheets (.xlsx, .xls, .csv) sheet-by-sheet using @e965/xlsx.
 * Inserts explicit sheet delimiters `=== [SHEET: NamaSheet] ===`.
 */
export async function extractExcelText(buffer: Buffer): Promise<ExtractorResult> {
  try {
    const XLSX = await import("@e965/xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });

    let fullOutput = "";
    let sheetCount = 0;

    for (const sheetName of workbook.SheetNames) {
      sheetCount++;
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) continue;

      const csv = XLSX.utils.sheet_to_csv(worksheet, { blankrows: false });
      if (!csv || !csv.trim()) continue;

      fullOutput += `\n\n=== [SHEET: ${sheetName}] ===\n${csv.trim()}`;
    }

    const trimmed = fullOutput.trim();

    return {
      success: true,
      text: trimmed,
      pageOrSheetCount: sheetCount,
      metadata: {
        totalSheets: sheetCount,
        sheetNames: workbook.SheetNames,
        charCount: trimmed.length,
      },
    };
  } catch (err) {
    return {
      success: false,
      text: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
