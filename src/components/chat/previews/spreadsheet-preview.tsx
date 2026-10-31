"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { dispatchAddEditChip } from "@/lib/files/preview-events";
import { useI18n } from "@/providers/i18n-provider";
import {
  parseDelimitedText,
  type ParsedSheet,
} from "./preview-utils";
import { CopyCodeButton, RawCodeSurface } from "./raw-code-surface";
import { RequestEditsButton } from "./request-edits-button";
import { TextEditPopover } from "./text-edit-popover";

export interface SpreadsheetPreviewProps {
  extension: string;
  textContent?: string;
  binaryContent?: ArrayBuffer;
  fileId?: string;
  filename?: string;
}

const PAGE_SIZE = 150;
const MAX_SHEET_ROWS = 2500;
const MAX_SHEET_COLS = 80;

export function SpreadsheetPreview({
  extension,
  textContent,
  binaryContent,
  fileId,
  filename,
}: SpreadsheetPreviewProps) {
  const { t } = useI18n();
  const ext = extension.toLowerCase();
  const isDelimitedText = ext === "csv" || ext === "tsv";

  const [excelSheets, setExcelSheets] = useState<ParsedSheet[] | null>(null);
  const [excelError, setExcelError] = useState(false);
  const [activeSheetIdx, setActiveSheetIdx] = useState(0);
  const [tab, setTab] = useState<"table" | "code">("table");
  const [query, setQuery] = useState("");
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  const [requestEditsActive, setRequestEditsActive] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{
    rowIdx: number;
    colIdx: number;
    colName: string;
    value: string;
    top: number;
    left: number;
  } | null>(null);
  const [debugMode, setDebugMode] = useState(false);

  function handleCellClick(
    e: React.MouseEvent<HTMLTableCellElement>,
    rowIdx: number,
    colIdx: number,
    colName: string,
    value: string
  ) {
    if (!requestEditsActive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setSelectedCell({
      rowIdx,
      colIdx,
      colName,
      value: String(value ?? ""),
      top: Math.max(10, rect.bottom + 6),
      left: Math.max(16, Math.min(window.innerWidth - 440, rect.left)),
    });
  }

  function handleSubmitEdit(prompt: string) {
    if (!selectedCell) return;
    const sheetPrefix = currentSheet?.name ? `${currentSheet.name} - ` : "";
    const chipId = `chip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    dispatchAddEditChip({
      id: chipId,
      fileId: fileId || "spreadsheet-file",
      filename: filename || `sheet.${ext}`,
      selectedText: selectedCell.value,
      instruction: prompt || undefined,
      cellRange: `${sheetPrefix}Row ${selectedCell.rowIdx + 1}, Col "${selectedCell.colName}"`,
    });
    setSelectedCell(null);
  }

  // Parse .xlsx / .xls asynchronously via @e965/xlsx
  useEffect(() => {
    if (isDelimitedText || !binaryContent) return;

    let active = true;
    (async () => {
      try {
        const XLSX = await import("@e965/xlsx");
        const workbook = XLSX.read(binaryContent, {
          type: "array",
          dense: true,
          sheetRows: MAX_SHEET_ROWS + 1,
        });

        const parsed: ParsedSheet[] = workbook.SheetNames.map((sheetName) => {
          const ws = workbook.Sheets[sheetName];
          const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
            header: 1,
            defval: "",
            raw: false,
          });

          const trimmed = rawRows
            .slice(0, MAX_SHEET_ROWS + 1)
            .map((row) =>
              (Array.isArray(row) ? row : [])
                .slice(0, MAX_SHEET_COLS)
                .map((cell) => (cell == null ? "" : String(cell)))
            );

          while (
            trimmed.length > 0 &&
            trimmed[trimmed.length - 1].every((c) => c.trim() === "")
          ) {
            trimmed.pop();
          }

          if (trimmed.length === 0) {
            return { name: sheetName, headers: [], rows: [] };
          }

          const colCount = Math.min(
            MAX_SHEET_COLS,
            trimmed.reduce((m, r) => Math.max(m, r.length), 0)
          );
          const firstRow = trimmed[0] || [];
          const headers = Array.from({ length: colCount }, (_, i) => {
            const h = (firstRow[i] ?? "").trim();
            return h || `Kolom ${i + 1}`;
          });
          const rows = trimmed.slice(1).map((r) =>
            Array.from({ length: colCount }, (_, i) => r[i] ?? "")
          );

          return { name: sheetName, headers, rows };
        });

        if (active) {
          setExcelSheets(parsed);
          setExcelError(false);
        }
      } catch {
        if (active) setExcelError(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [isDelimitedText, binaryContent]);

  const sheets = useMemo<ParsedSheet[] | null>(() => {
    if (isDelimitedText) {
      return [parseDelimitedText(textContent ?? "", ext.toUpperCase(), ext === "tsv")];
    }
    return excelSheets;
  }, [isDelimitedText, textContent, ext, excelSheets]);

  const safeSheetIdx = sheets && activeSheetIdx < sheets.length ? activeSheetIdx : 0;
  const currentSheet = sheets?.[safeSheetIdx] ?? null;

  const filteredAndSortedRows = useMemo(() => {
    if (!currentSheet) return [];
    const q = query.trim().toLowerCase();
    let list = q
      ? currentSheet.rows.filter((row) =>
          row.some((cell) => cell.toLowerCase().includes(q))
        )
      : currentSheet.rows;

    if (sortCol !== null && sortCol < currentSheet.headers.length) {
      const col = sortCol;
      const mult = sortDir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        const va = (a[col] ?? "").trim();
        const vb = (b[col] ?? "").trim();
        const na = Number(va.replace(/,/g, ""));
        const nb = Number(vb.replace(/,/g, ""));
        if (va !== "" && vb !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) {
          return (na - nb) * mult;
        }
        return va.localeCompare(vb, undefined, { numeric: true, sensitivity: "base" }) * mult;
      });
    }
    return list;
  }, [currentSheet, query, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredAndSortedRows.slice(start, start + PAGE_SIZE);
  }, [filteredAndSortedRows, safePage]);

  function handleSortColumn(colIndex: number) {
    if (sortCol === colIndex) {
      if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        setSortCol(null);
        setSortDir("asc");
      }
    } else {
      setSortCol(colIndex);
      setSortDir("asc");
    }
    setPage(1);
  }

  if (excelError) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-xs text-[var(--muted)] text-center">
        {t("chatFiles.previewError")}
      </div>
    );
  }

  if (!sheets || !currentSheet) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-xs text-[var(--muted)]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        <span>{t("chatFiles.previewLoading")}</span>
      </div>
    );
  }

  const tabBtn = (active: boolean) =>
    cn(
      "px-2.5 py-1 rounded-[6px] text-xs font-medium transition-colors cursor-pointer",
      active
        ? "bg-[var(--accent-soft)] text-[var(--ink)]"
        : "text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)]"
    );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Top Toolbar: Table/Code toggle + Search + Dimensions */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]/60 shrink-0">
        <div className="flex items-center gap-1.5">
          {isDelimitedText ? (
            <div className="flex items-center gap-1 mr-1">
              <button
                type="button"
                onClick={() => setTab("table")}
                className={tabBtn(tab === "table")}
              >
                {t("chatFiles.tabTable")}
              </button>
              <button
                type="button"
                onClick={() => setTab("code")}
                className={tabBtn(tab === "code")}
              >
                {t("chatFiles.tabCode")}
              </button>
            </div>
          ) : null}

          <span className="text-[11.5px] font-mono text-[var(--muted)]">
            {t("chatFiles.tableSummary", {
              rows: filteredAndSortedRows.length,
              cols: currentSheet.headers.length,
            })}
          </span>
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          {tab === "table" && currentSheet.rows.length > 0 ? (
            <div className="relative w-44 sm:w-52">
              <Search className="w-3.5 h-3.5 text-[var(--muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder={t("chatFiles.searchTable")}
                className="w-full h-7 pl-8 pr-2.5 rounded-[7px] border border-[var(--border)] bg-[var(--panel)] text-xs text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:outline-none focus:border-[var(--ink)]/40"
              />
            </div>
          ) : tab === "code" && isDelimitedText ? (
            <CopyCodeButton text={textContent ?? ""} />
          ) : null}

          <span className="w-px h-3.5 bg-[var(--border)] mx-0.5" aria-hidden="true" />

          <RequestEditsButton
            active={requestEditsActive}
            onClick={() => {
              setRequestEditsActive((prev) => {
                const next = !prev;
                if (!next) setSelectedCell(null);
                return next;
              });
            }}
          />
        </div>
      </div>

      {/* Multi-Sheet Selector Tabs (for Excel workbooks with >1 sheet) */}
      {tab === "table" && sheets.length > 1 ? (
        <div className="flex items-center gap-1 px-4 py-1.5 border-b border-[var(--border)] bg-[var(--panel)] overflow-x-auto shrink-0">
          {sheets.map((s, idx) => (
            <button
              key={`${s.name}-${idx}`}
              type="button"
              onClick={() => {
                setActiveSheetIdx(idx);
                setSortCol(null);
                setPage(1);
              }}
              className={cn(
                "px-2.5 py-1 rounded-[6px] text-xs font-medium whitespace-nowrap transition-colors cursor-pointer",
                idx === safeSheetIdx
                  ? "bg-[var(--accent-soft)] text-[var(--ink)] border border-[var(--border)]"
                  : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}

      {/* Main Content */}
      {tab === "code" && isDelimitedText ? (
        <RawCodeSurface
          code={textContent ?? ""}
          language="plaintext"
          fileId={fileId}
          filename={filename || `sheet.${ext}`}
          requestEditsActive={requestEditsActive}
          onRequestEditsClose={() => setRequestEditsActive(false)}
        />
      ) : currentSheet.headers.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-8 text-xs text-[var(--muted)]">
          {t("chatFiles.emptySheet")}
        </div>
      ) : (
        <>
          <div className="relative flex-1 min-h-0 overflow-auto">
            <table className="w-full border-collapse text-left text-[12.5px]">
              <thead className="sticky top-0 z-10 bg-[var(--surface)] shadow-[0_1px_0_var(--border)]">
                <tr>
                  <th className="sticky left-0 z-20 w-10 px-2.5 py-2 text-center font-mono text-[11px] font-medium text-[var(--muted)] bg-[var(--surface)] border-r border-[var(--border)] select-none">
                    #
                  </th>
                  {currentSheet.headers.map((header, colIdx) => {
                    const isSorted = sortCol === colIdx;
                    return (
                      <th
                        key={`${header}-${colIdx}`}
                        onClick={() => handleSortColumn(colIdx)}
                        className="px-3 py-2 font-semibold text-[var(--ink)] border-r border-[var(--border)]/60 whitespace-nowrap hover:bg-[var(--hover)]/70 transition-colors cursor-pointer select-none"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <span className="max-w-[220px] truncate">{header}</span>
                          {isSorted ? (
                            sortDir === "asc" ? (
                              <ArrowUp className="w-3 h-3 text-[var(--ink)] shrink-0" />
                            ) : (
                              <ArrowDown className="w-3 h-3 text-[var(--ink)] shrink-0" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-[var(--muted)]/50 shrink-0" />
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--divider)]">
                {pageRows.map((row, rIdx) => {
                  const rowNum = (safePage - 1) * PAGE_SIZE + rIdx + 1;
                  return (
                    <tr
                      key={rowNum}
                      className="hover:bg-[var(--hover)]/45 transition-colors"
                    >
                      <td className="sticky left-0 z-10 px-2.5 py-1.5 text-center font-mono text-[11px] text-[var(--muted)] bg-[var(--panel)] border-r border-[var(--border)] select-none">
                        {rowNum}
                      </td>
                      {row.map((cell, cIdx) => {
                        const isCellSelected =
                          selectedCell?.rowIdx === rowNum - 1 &&
                          selectedCell?.colIdx === cIdx;
                        const colName =
                          currentSheet.headers[cIdx] || `Col ${cIdx + 1}`;

                        return (
                          <td
                            key={cIdx}
                            onClick={(e) =>
                              handleCellClick(
                                e,
                                rowNum - 1,
                                cIdx,
                                colName,
                                cell
                              )
                            }
                            className={cn(
                              "px-3 py-1.5 text-[var(--ink)] border-r border-[var(--border)]/40 max-w-[300px] truncate font-mono text-[12px] transition-colors",
                              requestEditsActive &&
                                "cursor-pointer hover:bg-sky-500/20",
                              isCellSelected &&
                                "bg-sky-500/30 ring-2 ring-sky-400 font-semibold"
                            )}
                          >
                            {cell}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Popover for selected cell */}
            {selectedCell && (
              <TextEditPopover
                top={selectedCell.top}
                left={selectedCell.left}
                positionMode="fixed"
                badgeLabel={`Row ${selectedCell.rowIdx + 1}, ${selectedCell.colName}`}
                debugMode={debugMode}
                onToggleDebugMode={() => setDebugMode((v) => !v)}
                onSubmit={handleSubmitEdit}
                onCancel={() => setSelectedCell(null)}
              />
            )}
          </div>

          {totalPages > 1 ? (
            <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border)] bg-[var(--surface)]/60 text-xs text-[var(--muted)] shrink-0">
              <span className="font-mono">
                {t("chatFiles.pageOf", { page: safePage, total: totalPages })}
              </span>
              <div className="flex items-center gap-1">
                <Tooltip content={t("chatFiles.prevPage")} side="top">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="grid place-items-center w-7 h-7 rounded-[6px] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-35 disabled:pointer-events-none cursor-pointer"
                    aria-label={t("chatFiles.prevPage")}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                </Tooltip>
                <Tooltip content={t("chatFiles.nextPage")} side="top" align="end">
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="grid place-items-center w-7 h-7 rounded-[6px] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-35 disabled:pointer-events-none cursor-pointer"
                    aria-label={t("chatFiles.nextPage")}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </Tooltip>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
