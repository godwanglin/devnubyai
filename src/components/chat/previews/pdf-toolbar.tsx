"use client";

import React from "react";
import {
  ChevronLeft,
  ChevronRight,
  PanelLeft,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import { RequestEditsButton } from "./request-edits-button";

export interface PdfToolbarProps {
  numPages: number;
  currentPage: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  showThumbnails: boolean;
  onToggleThumbnails: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  requestEditsActive: boolean;
  onToggleRequestEdits: () => void;
}

export function PdfToolbar({
  numPages,
  currentPage,
  onPrevPage,
  onNextPage,
  showThumbnails,
  onToggleThumbnails,
  canZoomIn,
  canZoomOut,
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  searchOpen,
  onToggleSearch,
  requestEditsActive,
  onToggleRequestEdits,
}: PdfToolbarProps) {
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--panel)]/80 select-none shrink-0">
      {/* Left: Thumbnails & Page Stepper */}
      <div className="flex items-center gap-1">
        <Tooltip content={t("chatFiles.toggleThumbnails")} side="bottom" align="start">
          <button
            type="button"
            onClick={onToggleThumbnails}
            aria-pressed={showThumbnails}
            aria-label={t("chatFiles.toggleThumbnails")}
            className={cn(
              "grid place-items-center w-7 h-7 rounded-[6px] transition-colors cursor-pointer",
              showThumbnails
                ? "bg-[var(--accent-soft)] text-[var(--ink)]"
                : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
            )}
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        <span className="w-px h-3.5 bg-[var(--border)] mx-0.5" aria-hidden="true" />

        <Tooltip content={t("chatFiles.prevPage")} side="bottom">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={onPrevPage}
            className="grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
            aria-label={t("chatFiles.prevPage")}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        <span className="px-1 font-mono text-[11.5px] text-[var(--muted)] tabular-nums">
          {t("chatFiles.pageOf", { page: currentPage, total: numPages })}
        </span>

        <Tooltip content={t("chatFiles.nextPage")} side="bottom">
          <button
            type="button"
            disabled={currentPage >= numPages}
            onClick={onNextPage}
            className="grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
            aria-label={t("chatFiles.nextPage")}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      </div>

      {/* Right: Zoom, Search & Request Edits */}
      <div className="flex items-center gap-1">
        <Tooltip content={t("chatFiles.zoomOut")} side="bottom">
          <button
            type="button"
            disabled={!canZoomOut}
            onClick={onZoomOut}
            className="grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
            aria-label={t("chatFiles.zoomOut")}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        <Tooltip content={t("chatFiles.fitWidth")} side="bottom">
          <button
            type="button"
            onClick={onFitWidth}
            className="px-2 h-7 rounded-[6px] font-mono text-[11.5px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer tabular-nums"
          >
            {zoomPercent}%
          </button>
        </Tooltip>

        <Tooltip content={t("chatFiles.zoomIn")} side="bottom">
          <button
            type="button"
            disabled={!canZoomIn}
            onClick={onZoomIn}
            className="grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
            aria-label={t("chatFiles.zoomIn")}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        <span className="w-px h-3.5 bg-[var(--border)] mx-0.5" aria-hidden="true" />

        {/* Search in document */}
        <Tooltip content={t("chatFiles.searchInPdf")} side="bottom">
          <button
            type="button"
            onClick={onToggleSearch}
            aria-pressed={searchOpen}
            aria-label={t("chatFiles.searchInPdf")}
            className={cn(
              "grid place-items-center w-7 h-7 rounded-[6px] transition-colors cursor-pointer",
              searchOpen
                ? "bg-[var(--accent-soft)] text-[var(--ink)]"
                : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
            )}
          >
            <Search className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        <span className="w-px h-3.5 bg-[var(--border)] mx-0.5" aria-hidden="true" />

        {/* Request edits button */}
        <RequestEditsButton
          active={requestEditsActive}
          onClick={onToggleRequestEdits}
        />
      </div>
    </div>
  );
}
