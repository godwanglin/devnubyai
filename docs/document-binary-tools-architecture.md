# Document Binary Tools Architecture

## Overview
Tools for creating and modifying binary Office documents (.xlsx, .docx) directly from AI via structured JSON instructions — no arbitrary code execution required.

## Tools to Create

### 1. Spreadsheet Tools (`src/lib/tools/spreadsheet.ts`)

#### `create_spreadsheet`
Creates a new .xlsx file from structured data.

**Parameters:**
```typescript
interface CreateSpreadsheetParams {
  filename: string;                    // e.g. "report.xlsx"
  sheets: SheetData[];
}

interface SheetData {
  name: string;                        // Sheet name
  data?: (string | number | Formula)[][];  // 2D array of values
  headers?: string[];                  // Optional header row
  columns?: ColumnDef[];               // Column definitions (width, format)
}

interface ColumnDef {
  width?: number;                      // Column width in characters
  format?: 'text' | 'number' | 'currency' | 'percentage' | 'date' | 'formula';
  formula?: string;                    // Formula for entire column
}

interface Formula {
  type: 'formula';
  value: string;                       // e.g. "=SUM(A1:A10)"
}
```

**Returns:** `{ fileId, filename, url, sheetCount, rowCount }`

---

#### `modify_spreadsheet`
Modifies an existing .xlsx file in R2 storage.

**Parameters:**
```typescript
interface ModifySpreadsheetParams {
  fileId: string;                      // File ID from session storage
  operations: SpreadsheetOperation[];
}

type SpreadsheetOperation =
  | { type: 'set_cell'; sheet: string; cell: string; value: string | number | Formula }
  | { type: 'set_range'; sheet: string; range: string; values: (string | number | Formula)[][] }
  | { type: 'insert_rows'; sheet: string; startRow: number; count: number }
  | { type: 'delete_rows'; sheet: string; startRow: number; count: number }
  | { type: 'insert_columns'; sheet: string; startCol: number; count: number }
  | { type: 'delete_columns'; sheet: string; startCol: number; count: number }
  | { type: 'add_sheet'; name: string; data?: (string | number)[][] }
  | { type: 'rename_sheet'; oldName: string; newName: string }
  | { type: 'delete_sheet'; name: string }
  | { type: 'set_format'; sheet: string; range: string; format: FormatOptions }
  | { type: 'set_column_width'; sheet: string; column: number; width: number }
  | { type: 'merge_cells'; sheet: string; range: string }
  | { type: 'add_chart'; sheet: string; chart: ChartDef };

interface FormatOptions {
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  fontColor?: string;       // hex
  fillColor?: string;       // hex
  numberFormat?: string;    // excel format code
  alignment?: 'left' | 'center' | 'right';
  border?: BorderOptions;
}

interface BorderOptions {
  top?: BorderStyle;
  bottom?: BorderStyle;
  left?: BorderStyle;
  right?: BorderStyle;
}

interface BorderStyle {
  style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted';
  color?: string;
}

interface ChartDef {
  type: 'bar' | 'line' | 'pie' | 'scatter';
  title: string;
  dataRange: string;        // e.g. "Sheet1!A1:B10"
  position: { row: number; col: number };
}
```

**Returns:** `{ fileId, filename, url, operationsApplied: number }`

---

### 2. Document Tools (`src/lib/tools/document.ts`)

#### `create_document`
Creates a new .docx file from structured content.

**Parameters:**
```typescript
interface CreateDocumentParams {
  filename: string;                    // e.g. "report.docx"
  title?: string;
  sections: DocumentSection[];
}

type DocumentSection =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { type: 'paragraph'; text: string; style?: ParagraphStyle }
  | { type: 'bullet_list'; items: string[]; style?: ListStyle }
  | { type: 'numbered_list'; items: string[]; style?: ListStyle }
  | { type: 'table'; headers: string[]; rows: (string | number)[][]; style?: TableStyle }
  | { type: 'page_break' }
  | { type: 'toc' }                    // Table of Contents
  | { type: 'image'; src: string; alt?: string; width?: number; height?: number };

interface ParagraphStyle {
  alignment?: 'left' | 'center' | 'right' | 'justify';
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  fontColor?: string;
  spacing?: { before?: number; after?: number; line?: number };
}

interface ListStyle {
  bulletChar?: string;       // for bullet_list
  startNumber?: number;      // for numbered_list
}

interface TableStyle {
  headerBold?: boolean;
  headerFillColor?: string;
  borderColor?: string;
  borderSize?: number;
  columnWidths?: number[];   // percentages
}
```

**Returns:** `{ fileId, filename, url, pageCount, wordCount }`

---

#### `modify_document`
Modifies an existing .docx file.

**Parameters:**
```typescript
interface ModifyDocumentParams {
  fileId: string;
  operations: DocumentOperation[];
}

type DocumentOperation =
  | { type: 'replace_text'; search: string; replace: string; matchCase?: boolean; matchWholeWord?: boolean }
  | { type: 'replace_regex'; pattern: string; replace: string; flags?: string }
  | { type: 'insert_after'; anchor: string; content: DocumentSection }    // anchor = text to find
  | { type: 'insert_before'; anchor: string; content: DocumentSection }
  | { type: 'append'; content: DocumentSection }
  | { type: 'prepend'; content: DocumentSection }
  | { type: 'delete_paragraph'; index: number }
  | { type: 'delete_section'; headingText: string }
  | { type: 'update_table'; tableIndex: number; rows: (string | number)[][]; headers?: string[] }
  | { type: 'set_style'; range: StyleRange; style: ParagraphStyle }
  | { type: 'add_comment'; anchor: string; comment: string; author?: string };

interface StyleRange {
  type: 'paragraph' | 'heading' | 'all';
  index?: number;              // specific paragraph index
  headingLevel?: number;       // for heading type
}
```

**Returns:** `{ fileId, filename, url, operationsApplied: number }`

---

## Implementation Details

### Dependencies (Add to package.json)
```json
{
  "exceljs": "^4.4.0",           // Excel manipulation
  "docx": "^8.5.0",              // Word document generation
  "@types/exceljs": "^4.4.0"     // Types (if needed)
}
```

### Storage Integration
- Read existing file from R2 using existing `downloadFromR2`
- Write modified file back to R2 using existing `uploadToR2`
- Use existing `db` for metadata tracking
- File ID format: `spreadsheet_<uuid>` / `document_<uuid>`

### Error Handling
- Validate fileId exists and is correct type
- Catch library errors (corrupt file, invalid range, etc.)
- Return structured error with `code: "INVALID_RANGE" | "FILE_NOT_FOUND" | "CORRUPT_FILE"`

---

## Tool Registration
Add to `src/lib/tools/index.ts`:
```typescript
import { createSpreadsheetTool, modifySpreadsheetTool } from "./spreadsheet";
import { createDocumentTool, modifyDocumentTool } from "./document";

export const devnubyTools: RegisteredTool[] = [
  // ... existing tools
  createSpreadsheetTool,
  modifySpreadsheetTool,
  createDocumentTool,
  modifyDocumentTool,
];
```

---

## AI Usage Examples

### Create a financial report spreadsheet
```json
{
  "tool": "create_spreadsheet",
  "params": {
    "filename": "q3-financial-report.xlsx",
    "sheets": [
      {
        "name": "Revenue",
        "headers": ["Month", "Product A", "Product B", "Total"],
        "data": [
          ["Jan", 10000, 15000, { "type": "formula", "value": "=B2+C2" }],
          ["Feb", 12000, 14000, { "type": "formula", "value": "=B3+C3" }],
          ["Mar", 11000, 16000, { "type": "formula", "value": "=B4+C4" }]
        ],
        "columns": [
          { "width": 12 },
          { "width": 14, "format": "currency" },
          { "width": 14, "format": "currency" },
          { "width": 14, "format": "currency" }
        ]
      }
    ]
  }
}
```

### Modify existing spreadsheet
```json
{
  "tool": "modify_spreadsheet",
  "params": {
    "fileId": "spreadsheet_abc123",
    "operations": [
      { "type": "set_cell", "sheet": "Revenue", "cell": "B5", "value": 13000 },
      { "type": "set_range", "sheet": "Revenue", "range": "D2:D4", "values": [[{ "type": "formula", "value": "=B2+C2" }], [{ "type": "formula", "value": "=B3+C3" }], [{ "type": "formula", "value": "=B4+C4" }]] },
      { "type": "set_format", "sheet": "Revenue", "range": "A1:D1", "format": { "bold": true, "fillColor": "4472C4", "fontColor": "FFFFFF" } }
    ]
  }
}
```

### Create a document with table
```json
{
  "tool": "create_document",
  "params": {
    "filename": "project-proposal.docx",
    "title": "Project Proposal",
    "sections": [
      { "type": "heading", "level": 1, "text": "Executive Summary" },
      { "type": "paragraph", "text": "This proposal outlines..." },
      { "type": "heading", "level": 2, "text": "Timeline" },
      { "type": "table", "headers": ["Phase", "Start", "End", "Owner"], "rows": [
        ["Research", "2026-01-01", "2026-01-15", "Team A"],
        ["Development", "2026-01-16", "2026-02-28", "Team B"],
        ["Testing", "2026-03-01", "2026-03-15", "Team C"]
      ]}
    ]
  }
}
```