"use client";

import React from "react";
import { ChevronDown, ChevronUp, Loader2, Search, X } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/providers/i18n-provider";

export interface PdfSearchBarProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (q: string) => void;
  currentIndex: number;
  totalMatches: number;
  isSearching: boolean;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function PdfSearchBar({
  inputRef,
  query,
  onQueryChange,
  currentIndex,
  totalMatches,
  isSearching,
  onNext,
  onPrev,
  onClose,
}: PdfSearchBarProps) {
  const { t } = useI18n();
  const hasQuery = query.trim().length > 0;

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      role="search"
      aria-label={t("chatFiles.searchInPdf")}
      className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] select-none shrink-0 shadow-sm animate-in fade-in slide-in-from-top-1 duration-150"
    >
      {/* Search Input Box */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0 max-w-sm px-2 py-1 rounded-[6px] bg-[var(--panel)] border border-[var(--border)] focus-within:border-[var(--accent)] transition-colors">
        <Search className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("chatFiles.searchPlaceholder")}
          className="w-full bg-transparent border-0 outline-none text-xs text-[var(--ink)] placeholder:text-[var(--muted)] selection:bg-[var(--accent-soft)]"
          spellCheck={false}
          autoComplete="off"
        />
        {hasQuery && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="grid place-items-center w-4 h-4 rounded text-[var(--muted)] hover:text-[var(--ink)] transition-colors cursor-pointer shrink-0"
            aria-label="Clear search"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Match indicator & navigation controls */}
      <div className="flex items-center gap-1 shrink-0">
        {isSearching ? (
          <span className="flex items-center gap-1 px-1.5 font-mono text-[11px] text-[var(--muted)]">
            <Loader2 className="w-3 h-3 animate-spin" />
          </span>
        ) : hasQuery ? (
          <span
            className={`px-1.5 py-0.5 rounded font-mono text-[11px] tabular-nums ${
              totalMatches === 0
                ? "bg-red-500/10 text-red-600 dark:text-red-400 font-medium"
                : "text-[var(--muted)]"
            }`}
          >
            {totalMatches === 0
              ? t("chatFiles.searchNoResults")
              : t("chatFiles.searchMatches", {
                  current: currentIndex + 1,
                  total: totalMatches,
                })}
          </span>
        ) : null}

        <Tooltip content={t("chatFiles.searchPrev")} side="bottom">
          <button
            type="button"
            disabled={totalMatches === 0}
            onClick={onPrev}
            className="grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
            aria-label={t("chatFiles.searchPrev")}
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        <Tooltip content={t("chatFiles.searchNext")} side="bottom">
          <button
            type="button"
            disabled={totalMatches === 0}
            onClick={onNext}
            className="grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
            aria-label={t("chatFiles.searchNext")}
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        <span className="w-px h-3.5 bg-[var(--border)] mx-0.5" aria-hidden="true" />

        <Tooltip content={t("chatFiles.searchClose")} side="bottom" align="end">
          <button
            type="button"
            onClick={onClose}
            className="grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
            aria-label={t("chatFiles.searchClose")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
