"use client";

import React from "react";
import { Edit3, FileCode, Layers } from "lucide-react";

export interface ParsedEditTarget {
  targetNum?: number;
  filename: string;
  fileId?: string;
  location?: string;
  selectedText?: string;
  instruction?: string;
}

export interface ParsedRequestEditMessage {
  isEditRequest: boolean;
  targets: ParsedEditTarget[];
  userText: string;
}

/**
 * Parses structured [Request Edit] blocks from user message content into
 * clean metadata targets and the human-readable user instruction.
 */
export function parseRequestEditMessage(content: string): ParsedRequestEditMessage {
  if (!content || !content.trim().startsWith("[Request Edit")) {
    return { isEditRequest: false, targets: [], userText: content };
  }

  const targets: ParsedEditTarget[] = [];
  let userText = "";

  // Check for overall instruction at the end
  const overallMatch = content.match(/\nUser Overall Instruction:\s*([\s\S]*)$/i);
  if (overallMatch) {
    userText = overallMatch[1].trim();
  }

  // Remove overall instruction part before parsing target blocks
  const targetContent = overallMatch
    ? content.slice(0, overallMatch.index).trim()
    : content.trim();

  // Split into target blocks: either by "[Target #" or by hunk
  const rawBlocks = targetContent.split(/(?=\[Target\s*#?\d*\])/i);

  for (const block of rawBlocks) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith("[Request Edit -") || trimmed === "[Request Edit]") {
      continue;
    }

    const targetNumMatch = trimmed.match(/\[Target\s*#?(\d+)\]/i);
    const targetNum = targetNumMatch ? parseInt(targetNumMatch[1], 10) : targets.length + 1;

    const fileMatch = trimmed.match(/FileName:\s*([^\n\r]+)/i);
    const fileIdMatch = trimmed.match(/FileId:\s*([^\n\r]+)/i);
    const lineMatch = trimmed.match(/Line:\s*([^\n\r]+)/i);
    const elemMatch = trimmed.match(/Element:\s*([^\n\r]+)/i);
    const cellMatch = trimmed.match(/Cell\/Range:\s*([^\n\r]+)/i);
    const pageMatch = trimmed.match(/Halaman:\s*([^\n\r]+)/i);

    let location = "";
    if (lineMatch) location = `Line ${lineMatch[1].trim()}`;
    else if (cellMatch) location = cellMatch[1].trim();
    else if (elemMatch) location = elemMatch[1].trim();
    else if (pageMatch) location = `Hal ${pageMatch[1].trim()}`;

    let selectedText = "";
    const textMatch = trimmed.match(/User Selected Text:\s*[\r\n]+"([\s\S]*?)"(?=\s*(?:Instruction:|$))/i);
    if (textMatch) {
      selectedText = textMatch[1].trim();
    }

    let instruction = "";
    const instrMatch = trimmed.match(/(?:Instruction|User Instruction):\s*([\s\S]*?)(?=(?:\n---|\n\[Target|$))/i);
    if (instrMatch) {
      instruction = instrMatch[1].trim();
    }

    const filename = fileMatch ? fileMatch[1].trim() : "untitled";
    const fileId = fileIdMatch ? fileIdMatch[1].trim() : undefined;

    targets.push({
      targetNum,
      filename,
      fileId,
      location: location || undefined,
      selectedText: selectedText || undefined,
      instruction: instruction || undefined,
    });
  }

  // Fallback for single legacy block without [Target #1]
  if (targets.length === 0) {
    const fileMatch = content.match(/FileName:\s*([^\n\r]+)/i);
    const fileIdMatch = content.match(/FileId:\s*([^\n\r]+)/i);
    const lineMatch = content.match(/Line:\s*([^\n\r]+)/i);
    const elemMatch = content.match(/Element:\s*([^\n\r]+)/i);
    const cellMatch = content.match(/Cell\/Range:\s*([^\n\r]+)/i);
    const textMatch = content.match(/User Selected Text:\s*[\r\n]+"([\s\S]*?)"/i);
    const instrMatch = content.match(/(?:Instruction|User Instruction):\s*([\s\S]*?)$/i);

    if (fileMatch) {
      const filename = fileMatch[1].trim();
      const location = lineMatch
        ? `Line ${lineMatch[1].trim()}`
        : cellMatch
          ? cellMatch[1].trim()
          : elemMatch
            ? elemMatch[1].trim()
            : undefined;
      const instruction = instrMatch ? instrMatch[1].trim() : undefined;
      targets.push({
        targetNum: 1,
        filename,
        fileId: fileIdMatch ? fileIdMatch[1].trim() : undefined,
        location,
        selectedText: textMatch ? textMatch[1].trim() : undefined,
        instruction,
      });
      if (!userText && instruction) {
        userText = instruction;
      }
    }
  }

  // If userText was not set from overall instruction, check if there's target instruction to display
  if (!userText && targets.length === 1 && targets[0].instruction) {
    userText = targets[0].instruction;
  }

  return {
    isEditRequest: targets.length > 0,
    targets,
    userText,
  };
}

/**
 * Renders a compact chip above user message bubble for edit target selections.
 * On hover, reveals a detailed dark-glass popover card showing target filename,
 * element/line range, snippet, and specific instruction.
 */
export function EditTargetChip({ targets }: { targets: ParsedEditTarget[] }) {
  if (targets.length === 0) return null;

  const isSingle = targets.length === 1;
  const single = targets[0];
  const chipLabel = isSingle
    ? `${single.filename}${single.location ? ` · ${single.location}` : ""}`
    : `${targets.length} Target Edit`;

  return (
    <div className="relative group/editchip mb-1.5 self-end select-none">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--panel)] text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)] transition-colors cursor-default shadow-xs"
        aria-label={chipLabel}
      >
        {isSingle ? (
          <FileCode className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
        ) : (
          <Layers className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
        )}
        <span className="truncate max-w-[260px] text-[var(--ink)]">{chipLabel}</span>
      </button>

      {/* Floating Hover Card with Clean Details (glass utility + blur tokens) */}
      <div
        role="tooltip"
        className="absolute right-0 bottom-full mb-2 z-40 w-[min(380px,85vw)] max-h-[320px] overflow-y-auto p-3.5 space-y-2.5 rounded-[12px] glass text-[var(--ink)] shadow-2xl invisible opacity-0 translate-y-1 transition-[opacity,transform,visibility] duration-150 group-hover/editchip:visible group-hover/editchip:opacity-100 group-hover/editchip:translate-y-0 group-focus-within/editchip:visible group-focus-within/editchip:opacity-100 group-focus-within/editchip:translate-y-0"
      >
        <div className="flex items-center justify-between pb-1.5 border-b border-[var(--border)] text-xs font-semibold text-[var(--ink)]">
          <span className="inline-flex items-center gap-1.5">
            <Edit3 className="w-3.5 h-3.5 text-[var(--muted)]" />
            Target Edit ({targets.length})
          </span>
          <span className="text-[11px] text-[var(--muted)] font-mono truncate max-w-[180px]">
            {targets
              .map((t) => t.filename)
              .filter((v, i, a) => a.indexOf(v) === i)
              .join(", ")}
          </span>
        </div>

        {targets.map((target, idx) => (
          <div
            key={idx}
            className="p-2.5 rounded-[8px] bg-[var(--panel)]/70 border border-[var(--border)] space-y-1 text-xs"
          >
            <div className="flex items-center justify-between gap-2 font-mono">
              <span className="font-semibold text-[var(--ink)] truncate">
                #{target.targetNum || idx + 1} {target.filename}
              </span>
              {target.location ? (
                <span className="px-1.5 py-0.5 rounded-[4px] bg-[var(--hover)] text-[var(--muted)] text-[10px] border border-[var(--border)] shrink-0">
                  {target.location}
                </span>
              ) : null}
            </div>

            {target.selectedText ? (
              <div className="text-[11px] text-[var(--muted)]">
                <span className="text-[var(--placeholder)] mr-1">Cuplikan:</span>
                <span className="italic font-mono text-[var(--ink)]">
                  &ldquo;
                  {target.selectedText.length > 120
                    ? `${target.selectedText.slice(0, 120)}...`
                    : target.selectedText}
                  &rdquo;
                </span>
              </div>
            ) : null}

            {target.instruction ? (
              <div className="text-[11px] text-[var(--ink)] pt-0.5">
                <span className="text-[var(--placeholder)] mr-1">Instruksi:</span>
                {target.instruction}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
