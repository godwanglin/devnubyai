"use client";

import React, { useState, useEffect, useRef } from "react";
import { ChevronDown, Globe, Loader2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import { getFaviconUrl, type CompactWebSource } from "@/lib/tools/compact-source";
import type { ToolActivity } from "@/types";

interface SearchActivityAccordionProps {
  tools: ToolActivity[];
  embedded?: boolean;
}

export function SearchActivityAccordion({
  tools,
  embedded = false,
}: SearchActivityAccordionProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);

  // Group all web_search and deep_search items
  const isRunning = tools.some(
    (t) => t.state === "running" || t.state === "streaming"
  );

  // Calculate total duration for search tools:
  // Either from persisted durationSec in DB or live elapsed timer
  const persistedDuration = tools.reduce((acc, curr) => acc + (curr.durationSec ?? 0), 0);
  const [liveSeconds, setLiveSeconds] = useState<number | null>(null);
  const timerStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (isRunning) {
      if (timerStartRef.current === null) timerStartRef.current = Date.now();
      const start = timerStartRef.current;
      const tick = () => setLiveSeconds(Math.max(1, Math.round((Date.now() - start) / 1000)));
      tick();
      const interval = setInterval(tick, 1000);
      return () => {
        clearInterval(interval);
        tick();
      };
    }
  }, [isRunning]);

  const effectiveDuration = isRunning
    ? liveSeconds
    : persistedDuration > 0
      ? persistedDuration
      : null;

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
      ? t("message.deepSearching")
      : t("message.searchingWeb")
    : isDeep
      ? t("message.doneDeepSearch")
      : t("message.searchedTheWeb");

  return (
    <div className={cn("select-none font-sans", embedded ? "mb-0" : "mb-3")}>
      {/* Header bar matching soft Thought-for-Xs style */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="inline-flex items-center gap-2 py-1 px-1.5 -ml-1.5 rounded-[8px] text-left cursor-pointer group hover:bg-[var(--hover)] transition-colors max-w-full"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2 text-[13.5px] font-medium text-[var(--muted)] group-hover:text-[var(--ink)] transition-colors min-w-0 max-w-full">
          {isRunning ? (
            <Loader2 className="w-4 h-4 text-[var(--muted)] animate-spin shrink-0" />
          ) : (
            <Globe className="w-4 h-4 text-[var(--muted)] shrink-0" />
          )}

          <span className="shrink-0">{mainLabel}</span>

          {effectiveDuration !== null ? (
            <span className="text-[12px] text-[var(--muted)] font-mono shrink-0">
              ({effectiveDuration}s)
            </span>
          ) : null}

          {primaryQuery ? (
            <span
              title={primaryQuery}
              className="font-normal text-[var(--ink)]/85 truncate max-w-[200px] sm:max-w-[340px]"
            >
              &ldquo;{primaryQuery}&rdquo;
            </span>
          ) : null}

          {allSources.length > 0 ? (
            <span className="text-[11.5px] text-[var(--muted)] ml-0.5 shrink-0">
              · {t("message.searchSourcesCount", { count: allSources.length })}
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

      {/* Source cards in a grid; each card shows the page title, its domain and a snippet */}
      {isOpen && allSources.length > 0 ? (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 py-1">
          {allSources.map((source, idx) => (
            <a
              key={`${source.url}-${idx}`}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              title={source.title || source.domain || source.url}
              className={cn(
                "group flex flex-col gap-1.5 min-w-0 p-3 rounded-[12px] border border-[var(--border)]",
                "bg-[var(--panel)] hover:bg-[var(--hover)] hover:border-[var(--accent)]/40 transition-colors"
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
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
                <span className="truncate text-[12px] text-[var(--muted)]">
                  {source.domain || source.url}
                </span>
                <ExternalLink className="ml-auto w-3 h-3 shrink-0 text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              <span className="text-[13.5px] font-medium leading-snug text-[var(--ink)] line-clamp-2 group-hover:text-[var(--accent)] transition-colors">
                {source.title || source.domain || source.url}
              </span>

              {source.snippet ? (
                <span className="text-[12px] leading-relaxed text-[var(--muted)] line-clamp-2">
                  {source.snippet}
                </span>
              ) : null}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
