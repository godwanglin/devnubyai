"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { DraftSheet } from "@/lib/live-draft/types";
import { DraftCaret } from "./draft-inline";

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

/** Workbook draft: a sheet grid with tabs, like the spreadsheet preview. */
export function DraftSheets({ sheets, typing }: { sheets: DraftSheet[]; typing: boolean }) {
  const [picked, setPicked] = useState<number | null>(null);
  // Follow the sheet being written unless the user picked one
  const active = Math.min(picked ?? sheets.length - 1, sheets.length - 1);
  const sheet = sheets[active];
  if (!sheet) return null;
  const cols = Math.max(1, ...sheet.cells.map((r) => r.length));
  let lastRow = -1;
  let lastCol = -1;
  sheet.cells.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell !== null && cell !== "") {
        lastRow = r;
        lastCol = c;
      }
    })
  );

  return (
    <div className="mx-auto w-full max-w-full overflow-hidden rounded-[6px] border border-[var(--border)] bg-white">
      {sheets.length > 1 ? (
        <div className="flex gap-1 overflow-x-auto border-b border-[#e2e8f0] bg-[#f8fafc] px-2 py-1.5">
          {sheets.map((s, i) => (
            <Button
              key={`${s.name}-${i}`}
              size="sm"
              variant={i === active ? "secondary" : "ghost"}
              onClick={() => setPicked(i)}
              className={cn("h-7 px-2.5 text-[12px] shrink-0", i === active ? "!text-[#0f172a] !bg-white" : "!text-[#64748b]")}
            >
              {s.name}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="max-h-[70vh] overflow-auto">
        <table className="border-collapse text-[12px] text-[#111111]" style={{ fontFamily: "Calibri, Carlito, Arial, sans-serif" }}>
          <thead>
            <tr>
              <th className="sticky top-0 z-10 min-w-[36px] border border-[#e2e8f0] bg-[#f1f5f9] px-1 text-[11px] font-normal text-[#64748b]" />
              {Array.from({ length: cols }, (_, c) => (
                <th
                  key={c}
                  className="sticky top-0 z-10 border border-[#e2e8f0] bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-normal text-[#64748b]"
                  style={{ minWidth: Math.max(64, (sheet.colWidths[c] || 0) * 7) }}
                >
                  {columnLetter(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.cells.map((row, r) => (
              <tr key={r}>
                <td className="border border-[#e2e8f0] bg-[#f8fafc] px-1 text-center text-[11px] text-[#64748b]">{r + 1}</td>
                {Array.from({ length: cols }, (_, c) => (
                  <td
                    key={c}
                    className={cn("border border-[#e2e8f0] px-2 py-0.5 whitespace-nowrap", sheet.bold[r]?.[c] && "font-bold")}
                    style={{ textAlign: row[c] !== null && /^-?[\d.,]+%?$/.test(row[c] ?? "") ? "right" : "left" }}
                  >
                    {row[c] ?? ""}
                    {typing && sheet.typing && r === lastRow && c === lastCol ? <DraftCaret /> : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
