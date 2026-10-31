"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";

export interface DocumentViewerLayoutProps {
  title: string;
  toolbar: React.ReactNode;
  /** Rendered under the toolbar (search strip) */
  searchBar?: React.ReactNode;
  /** Left rail (thumbnails / chapter list) */
  sidebar?: React.ReactNode;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Shows a loader over the (still mounted) content */
  loading?: boolean;
  /** Replaces the content with an error message */
  error?: string | null;
  scrollClassName?: string;
  children: React.ReactNode;
}

/**
 * Frame shared by the document previews: toolbar, optional search strip, optional
 * left rail and the scroll area. Content stays mounted while loading so renderers
 * that need a DOM node (docx-preview) can draw into it.
 */
export function DocumentViewerLayout({
  title,
  toolbar,
  searchBar,
  sidebar,
  scrollRef,
  loading = false,
  error = null,
  scrollClassName,
  children,
}: DocumentViewerLayoutProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--surface)]">
      {toolbar}
      {searchBar}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {sidebar}

        <div
          ref={scrollRef}
          aria-label={title}
          aria-busy={loading}
          className={cn("relative flex-1 min-w-0 min-h-0 overflow-auto", scrollClassName)}
        >
          {error !== null ? (
            <div className="h-full flex flex-col items-center justify-center gap-1.5 p-8 text-center">
              <p className="text-xs text-[var(--muted)]">{t("chatFiles.previewError")}</p>
              {error && <p className="text-[11.5px] text-[var(--placeholder)] max-w-xs">{error}</p>}
            </div>
          ) : (
            <>
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-[var(--muted)]">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  <span>{t("chatFiles.previewLoading")}</span>
                </div>
              )}
              <div className={cn(loading && "invisible")}>{children}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
