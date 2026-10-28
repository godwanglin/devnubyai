"use client";

import React, { useState } from "react";
import { ChevronDown, Globe, Loader2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import { getFaviconUrl, type CompactWebSource } from "@/lib/tools/compact-source";
import type { ToolActivity } from "@/types";

interface SearchActivityAccordionProps {
  tools: ToolActivity[];
}

export function SearchActivityAccordion({ tools }: SearchActivityAccordionProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);

  // Group all web_search and deep_search items
  const isRunning = tools.some(
    (t) => t.state === "running" || t.state === "streaming"
  );

  // Primary query/topic display
  const primaryQuery =
    (tools[0]?.input as { query?: string; topic?: string })?.query ||
    (tools[0]?.input as { query?: string; topic?: string })?.topic ||
    "";

  // Aggregate sources across all search tools in this run
  const allSources: CompactWebSource[] = [];
  const seenUrls = new Set<string>();

  for (const tool of tools) {
    const out = tool.output as {
      sources?: CompactWebSource[];
      results?: Array<{ title?: string; url?: string; snippet?: string }>;
      allSources?: string[];
    } | undefined;

    if (Array.isArray(out?.sources)) {
      for (const s of out.sources) {
        if (s?.url && !seenUrls.has(s.url)) {
          seenUrls.add(s.url);
          allSources.push(s);
        }
      }
    } else if (Array.isArray(out?.results)) {
      for (const r of out.results) {
        if (r?.url && !seenUrls.has(r.url)) {
          seenUrls.add(r.url);
          let domain = "";
          try {
            domain = new URL(r.url).hostname.replace(/^www\./, "");
          } catch {}
          allSources.push({
            title: r.title || domain || "Web Result",
            url: r.url,
            domain,
            favicon: getFaviconUrl(r.url),
            snippet: r.snippet,
          });
        }
      }
    } else if (Array.isArray(out?.allSources)) {
      for (const url of out.allSources) {
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url);
          let domain = "";
          try {
            domain = new URL(url).hostname.replace(/^www\./, "");
          } catch {}
          allSources.push({
            title: domain || "Source",
            url,
            domain,
            favicon: getFaviconUrl(url),
          });
        }
      }
    }
  }

  const isDeep = tools.some((t) => t.name === "deep_search");
  const mainLabel = isRunning
    ? isDeep
      ? t("message.searchingTopic", { topic: primaryQuery || "topik" })
      : t("message.searchingWeb")
    : isDeep
      ? t("message.doneDeepSearch")
      : t("message.doneWebSearch");

  return (
    <div className="mb-3.5 select-none font-sans">
      {/* Header bar matching Claude.ai screenshot */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="inline-flex items-center gap-2 py-1 px-1.5 -ml-1.5 rounded-[8px] text-left cursor-pointer group hover:bg-[var(--hover)]/40 transition-colors"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2 text-[13.5px] font-medium text-[var(--muted)] group-hover:text-[var(--ink)] transition-colors">
          {isRunning ? (
            <Loader2 className="w-4 h-4 text-[var(--accent)] animate-spin shrink-0" />
          ) : (
            <Globe className="w-4 h-4 text-emerald-400 shrink-0" />
          )}

          <span>{mainLabel}</span>

          {primaryQuery ? (
            <span className="font-normal text-[var(--ink)]/85 truncate max-w-[240px] sm:max-w-[360px]">
              {primaryQuery}
            </span>
          ) : null}

          {allSources.length > 0 ? (
            <span className="text-[11.5px] text-[var(--muted)] font-mono ml-0.5">
              ({allSources.length})
            </span>
          ) : null}
        </span>

        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 text-[var(--muted)]/70 transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {/* Accordion Sources list matching Image 2 */}
      {isOpen && allSources.length > 0 ? (
        <div className="mt-2 pl-3 sm:pl-3.5 border-l-2 border-[var(--border)] space-y-1.5 py-1">
          {allSources.map((source, idx) => (
            <a
              key={`${source.url}-${idx}`}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "group flex items-center justify-between gap-3 px-2 py-1.5 rounded-[6px]",
                "hover:bg-[var(--hover)]/60 transition-colors text-[13px]"
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                {source.favicon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={source.favicon}
                    alt=""
                    className="w-4 h-4 shrink-0 rounded-[3px] bg-white/10"
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = "none";
                    }}
                  />
                ) : (
                  <Globe className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
                )}
                <span className="truncate text-[var(--ink)] group-hover:text-[var(--accent)] transition-colors">
                  {source.title || source.domain || source.url}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 text-[12px] text-[var(--muted)] group-hover:text-[var(--ink)] font-mono">
                <span>{source.domain}</span>
                <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
