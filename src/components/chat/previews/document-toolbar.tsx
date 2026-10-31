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

export interface DocumentToolbarPaging {
  numPages: number;
  currentPage: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  /** Replaces the default "Page X / Y" label (e.g. slides, chapters) */
  label?: string;
  prevLabel?: string;
  nextLabel?: string;
}

export interface DocumentToolbarProps {
  /** Format badge, e.g. "DOCX" */
  kindLabel?: string;
  /** Omit for documents without pages (page stepper hidden) */
  paging?: DocumentToolbarPaging;
  /** Omit to hide the thumbnails toggle */
  showThumbnails?: boolean;
  onToggleThumbnails?: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  requestEditsActive?: boolean;
  /** Omit to hide the "Request edits" button */
  onToggleRequestEdits?: () => void;
}

const ICON_BUTTON =
  "grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer";

function toggleClass(active: boolean) {
  return cn(
    "grid place-items-center w-7 h-7 rounded-[6px] transition-colors cursor-pointer",
    active
      ? "bg-[var(--accent-soft)] text-[var(--ink)]"
      : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
  );
}

function Divider() {
  return <span className="w-px h-3.5 bg-[var(--border)] mx-0.5" aria-hidden="true" />;
}

/** Viewer toolbar shared by every paged preview: thumbnails, page stepper, zoom, search, request edits. */
export function DocumentToolbar({
  kindLabel,
  paging,
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
  requestEditsActive = false,
  onToggleRequestEdits,
}: DocumentToolbarProps) {
  const { t } = useI18n();
  const prevLabel = paging?.prevLabel ?? t("chatFiles.prevPage");
  const nextLabel = paging?.nextLabel ?? t("chatFiles.nextPage");

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--panel)]/80 select-none shrink-0">
      {/* Left: thumbnails, page stepper, format badge */}
      <div className="flex items-center gap-1 min-w-0">
        {onToggleThumbnails && (
          <>
            <Tooltip content={t("chatFiles.toggleThumbnails")} side="bottom" align="start">
              <button
                type="button"
                onClick={onToggleThumbnails}
                aria-pressed={Boolean(showThumbnails)}
                aria-label={t("chatFiles.toggleThumbnails")}
                className={toggleClass(Boolean(showThumbnails))}
              >
                <PanelLeft className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
            {paging && <Divider />}
          </>
        )}

        {paging && (
          <>
            <Tooltip content={prevLabel} side="bottom">
              <button
                type="button"
                disabled={paging.currentPage <= 1}
                onClick={paging.onPrevPage}
                className={ICON_BUTTON}
                aria-label={prevLabel}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            </Tooltip>

            <span className="px-1 font-mono text-[11.5px] text-[var(--muted)] tabular-nums whitespace-nowrap">
              {paging.label ?? t("chatFiles.pageOf", { page: paging.currentPage, total: paging.numPages })}
            </span>

            <Tooltip content={nextLabel} side="bottom">
              <button
                type="button"
                disabled={paging.currentPage >= paging.numPages}
                onClick={paging.onNextPage}
                className={ICON_BUTTON}
                aria-label={nextLabel}
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          </>
        )}

        {kindLabel && (
          <span className="ml-1 px-2 py-0.5 rounded-[6px] text-[11px] font-medium bg-[var(--accent-soft)] text-[var(--ink)] shrink-0">
            {kindLabel}
          </span>
        )}
      </div>

      {/* Right: zoom, search, request edits */}
      <div className="flex items-center gap-1 shrink-0">
        <Tooltip content={t("chatFiles.zoomOut")} side="bottom">
          <button
            type="button"
            disabled={!canZoomOut}
            onClick={onZoomOut}
            className={ICON_BUTTON}
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
            className={ICON_BUTTON}
            aria-label={t("chatFiles.zoomIn")}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        <Divider />

        <Tooltip content={t("chatFiles.searchInPdf")} side="bottom" align="end">
          <button
            type="button"
            onClick={onToggleSearch}
            aria-pressed={searchOpen}
            aria-label={t("chatFiles.searchInPdf")}
            className={toggleClass(searchOpen)}
          >
            <Search className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        {onToggleRequestEdits && (
          <>
            <Divider />
            <RequestEditsButton active={requestEditsActive} onClick={onToggleRequestEdits} />
          </>
        )}
      </div>
    </div>
  );
}
