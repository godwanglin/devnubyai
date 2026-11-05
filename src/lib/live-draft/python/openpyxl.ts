import { DRAFT_LIMITS, type DraftSheet } from "../types";
import { NONE, UNKNOWN_VAL, isIncomplete, isObj, iterItems, obj, str, toNumber, toText, truthy, type PyVal } from "./values";

/** openpyxl workbook / worksheet modelled as plain grids. */

interface SheetState {
  name: string;
  cells: Map<string, { value: PyVal; bold: boolean }>;
  maxRow: number;
  maxCol: number;
  appendRow: number;
  colWidths: Map<number, number>;
}

function newSheet(name: string): PyVal & { t: "obj" } {
  const state: SheetState = { name, cells: new Map(), maxRow: -1, maxCol: -1, appendRow: 0, colWidths: new Map() };
  return obj("sheet", { state });
}

export function makeWorkbook(): PyVal & { t: "obj" } {
  const first = newSheet("Sheet");
  return obj("workbook", { sheets: [first], active: first });
}

function columnIndex(letters: string): number {
  let index = 0;
  for (const ch of letters.toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** `A1` → [row, col] (0-based); null for ranges or bad refs. */
function parseRef(ref: string): [number, number] | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,6})$/.exec(ref.trim());
  if (!m) return null;
  return [Number(m[2]) - 1, columnIndex(m[1])];
}

function setCell(state: SheetState, row: number, col: number, value: PyVal, bold?: boolean): void {
  if (row < 0 || col < 0 || row >= DRAFT_LIMITS.sheetRows || col >= DRAFT_LIMITS.sheetCols) return;
  const key = `${row},${col}`;
  const existing = state.cells.get(key);
  state.cells.set(key, { value, bold: bold ?? existing?.bold ?? false });
  state.maxRow = Math.max(state.maxRow, row);
  state.maxCol = Math.max(state.maxCol, col);
  state.appendRow = Math.max(state.appendRow, row + 1);
}

function cellObj(sheet: PyVal & { t: "obj" }, row: number, col: number): PyVal {
  return obj("cell", { sheet, row, col });
}

export function workbookMethod(wb: PyVal & { t: "obj" }, name: string, args: PyVal[], kw: Map<string, PyVal>): PyVal | null {
  const sheets = wb.props.sheets as (PyVal & { t: "obj" })[];
  switch (name) {
    case "create_sheet": {
      const sheet = newSheet(toText(kw.get("title") ?? args[0]) || `Sheet${sheets.length + 1}`);
      sheets.push(sheet);
      return sheet;
    }
    case "remove":
    case "remove_sheet": {
      const index = sheets.indexOf(args[0] as PyVal & { t: "obj" });
      if (index >= 0) sheets.splice(index, 1);
      return NONE;
    }
    case "save":
      return NONE;
    default:
      return null;
  }
}

export function workbookAttr(wb: PyVal & { t: "obj" }, name: string): PyVal | null {
  if (name === "active") return (wb.props.active as PyVal) ?? NONE;
  if (name === "worksheets") return { t: "list", items: [...(wb.props.sheets as PyVal[])] };
  if (name === "sheetnames") return { t: "list", items: (wb.props.sheets as (PyVal & { t: "obj" })[]).map((s) => str((s.props.state as SheetState).name)) };
  return null;
}

export function workbookItem(wb: PyVal & { t: "obj" }, key: PyVal): PyVal | null {
  const name = toText(key);
  return (wb.props.sheets as (PyVal & { t: "obj" })[]).find((s) => (s.props.state as SheetState).name === name) ?? null;
}

export function sheetMethod(sheet: PyVal & { t: "obj" }, name: string, args: PyVal[], kw: Map<string, PyVal>): PyVal | null {
  const state = sheet.props.state as SheetState;
  switch (name) {
    case "append": {
      const values = iterItems(args[0] ?? UNKNOWN_VAL);
      if (!values) return NONE;
      const row = state.appendRow;
      values.forEach((value, col) => setCell(state, row, col, value));
      state.appendRow = row + 1;
      return NONE;
    }
    case "cell": {
      const row = toNumber(kw.get("row") ?? args[0], 1) - 1;
      const col = toNumber(kw.get("column") ?? args[1], 1) - 1;
      const value = kw.get("value") ?? args[2];
      if (value) setCell(state, row, col, value);
      return cellObj(sheet, row, col);
    }
    case "merge_cells":
    case "unmerge_cells":
    case "add_data_validation":
    case "add_chart":
    case "add_image":
    case "insert_rows":
    case "freeze_panes":
      return NONE;
    default:
      return null;
  }
}

export function sheetAttr(sheet: PyVal & { t: "obj" }, name: string): PyVal | null {
  const state = sheet.props.state as SheetState;
  if (name === "title") return str(state.name);
  if (name === "max_row") return { t: "num", v: state.maxRow + 1 };
  if (name === "max_column") return { t: "num", v: state.maxCol + 1 };
  if (name === "column_dimensions") return obj("dims", { sheet });
  return null;
}

export function sheetSetAttr(sheet: PyVal & { t: "obj" }, name: string, value: PyVal): void {
  if (name === "title") (sheet.props.state as SheetState).name = toText(value) || "Sheet";
}

export function sheetItem(sheet: PyVal & { t: "obj" }, key: PyVal): PyVal | null {
  const ref = parseRef(toText(key));
  return ref ? cellObj(sheet, ref[0], ref[1]) : null;
}

export function sheetSetItem(sheet: PyVal & { t: "obj" }, key: PyVal, value: PyVal): void {
  const ref = parseRef(toText(key));
  if (ref) setCell(sheet.props.state as SheetState, ref[0], ref[1], value);
}

export function cellSetAttr(cell: PyVal & { t: "obj" }, name: string, value: PyVal): void {
  const sheet = cell.props.sheet as PyVal & { t: "obj" };
  const state = sheet.props.state as SheetState;
  const row = cell.props.row as number;
  const col = cell.props.col as number;
  if (name === "value") setCell(state, row, col, value);
  if (name === "font" && isObj(value, "xlfont")) {
    const existing = state.cells.get(`${row},${col}`);
    setCell(state, row, col, existing?.value ?? str(""), Boolean(value.props.bold));
  }
}

export function dimsItem(dims: PyVal & { t: "obj" }, key: PyVal): PyVal {
  return obj("dim", { sheet: dims.props.sheet, col: columnIndex(toText(key)) });
}

export function dimSetAttr(dim: PyVal & { t: "obj" }, name: string, value: PyVal): void {
  if (name !== "width") return;
  const state = (dim.props.sheet as PyVal & { t: "obj" }).props.state as SheetState;
  state.colWidths.set(dim.props.col as number, toNumber(value, 10));
}

export function makeXlFont(kw: Map<string, PyVal>): PyVal {
  return obj("xlfont", { bold: truthy(kw.get("bold") ?? { t: "bool", v: false }) });
}

function cellText(value: PyVal): string {
  if (value.t === "num") return Number.isInteger(value.v) ? String(value.v) : String(Math.round(value.v * 100) / 100);
  if (value.t === "none" || value.t === "unknown") return "";
  return toText(value);
}

export function workbookSheets(wb: PyVal & { t: "obj" }): DraftSheet[] {
  return (wb.props.sheets as (PyVal & { t: "obj" })[]).map((sheet) => {
    const state = sheet.props.state as SheetState;
    const rows = Math.max(0, state.maxRow + 1);
    const cols = Math.max(0, state.maxCol + 1);
    const cells: (string | null)[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
    const bold: boolean[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
    let typing = false;
    state.cells.forEach((cell, key) => {
      const [r, c] = key.split(",").map(Number);
      cells[r][c] = cellText(cell.value);
      bold[r][c] = cell.bold;
      if (isIncomplete(cell.value)) typing = true;
    });
    const colWidths = Array.from({ length: cols }, (_, c) => state.colWidths.get(c) ?? 0);
    return { name: state.name, cells, bold, colWidths, typing };
  });
}

export { columnLetter };
