"use client";

import React, { useState } from "react";
import { ExternalLink, Globe } from "lucide-react";
import { cn } from "@/lib/cn";
import { getFaviconUrl, type CompactWebSource } from "@/lib/tools/compact-source";

interface CitationBadgeProps {
  href: string;
  children: React.ReactNode;
  sourcesMap?: Map<string, CompactWebSource>;
}

export function CitationBadge({ href, children, sourcesMap }: CitationBadgeProps) {
  const [isHovered, setIsHovered] = useState(false);

  let domain = "";
  try {
    domain = new URL(href).hostname.replace(/^www\./, "");
  } catch {}

  const sourceMeta = sourcesMap?.get(href);
  const title = sourceMeta?.title || domain || "Source";
  const favicon = sourceMeta?.favicon || getFaviconUrl(href);

  return (
    <span
      className="relative inline-block align-baseline"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex items-center gap-1.5 mx-1 px-2 py-0.5 rounded-[6px]",
          "bg-white/[0.06] hover:bg-white/[0.12] text-[var(--ink)] font-normal text-[12px] leading-none",
          "border border-white/[0.08] hover:border-white/[0.18] transition-all cursor-pointer no-underline select-none"
        )}
      >
        {favicon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={favicon}
            alt=""
            className="w-3.5 h-3.5 rounded-[2px] shrink-0 bg-white/10"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = "none";
            }}
          />
        ) : null}
        <span className="truncate max-w-[140px]">{children || domain}</span>
        <ExternalLink className="w-2.5 h-2.5 opacity-55 shrink-0" />
      </a>

      {/* Popover preview matching Claude.ai Image 3 (glass + backdrop-blur) */}
      {/* Spans only: this renders inside markdown <p>, where <div> is invalid HTML */}
      {isHovered && href ? (
        <span
          role="tooltip"
          className={cn(
            "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 block w-72 p-3 rounded-[12px]",
            "glass popover-panel text-[var(--ink)] shadow-2xl",
            "pointer-events-none transition-all duration-150 font-sans"
          )}
        >
          <span className="flex items-start gap-2.5">
            {favicon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={favicon}
                alt=""
                className="w-4 h-4 rounded-[3px] shrink-0 mt-0.5 bg-white/10"
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = "none";
                }}
              />
            ) : (
              <Globe className="w-4 h-4 text-[var(--muted)] shrink-0 mt-0.5" />
            )}
            <span className="block min-w-0 flex-1">
              <span className="block text-[12.5px] font-semibold text-[var(--ink)] leading-snug break-words">
                {title}
              </span>
              <span className="block text-[11px] text-[var(--muted)] truncate font-mono mt-0.5">
                {domain || href}
              </span>
            </span>
          </span>
        </span>
      ) : null}
    </span>
  );
}
