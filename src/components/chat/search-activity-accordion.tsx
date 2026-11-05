"use client";

import React, { useState, useEffect, useRef } from "react";
import { ChevronDown, Globe, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import { getFaviconUrl, type CompactWebSource } from "@/lib/tools/compact-source";
import type { ToolActivity } from "@/types";

interface SearchActivityAccordionProps {
  tools: ToolActivity[];
  embedded?: boolean;
}

/** Sources shown as chips before the rest collapse into one "+N more" chip. */
const VISIBLE_SOURCE_LIMIT = 7;
/** Favicons stacked on the "+N more" chip. */
const STACKED_FAVICONS = 3;

/** The site's host as shown on its chip (`www.kemkes.go.id`), falling back to the stored domain. */
function hostOf(source: CompactWebSource): string {
  try {
    return new URL(source.url).hostname;
  } catch {
    return source.domain || source.url;
  }
}

export function SourceFavicon({ src, className }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <Globe className={cn("shrink-0 text-[var(--muted)]", className)} aria-hidden="true" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full bg-white/10 object-cover", className)}
    />
  );
}

/** Pill chips of the searched sites: up to 7, then one stacked-favicon chip for the rest. */
function SourceChips({ sources }: { sources: CompactWebSource[] }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? sources : sources.slice(0, VISIBLE_SOURCE_LIMIT);
  const hidden = expanded ? [] : sources.slice(VISIBLE_SOURCE_LIMIT);

  const chipClass =
    "inline-flex max-w-[240px] items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1 text-[12px] text-[var(--ink)]/85 transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)]";

  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((source, idx) => (
        <a
          key={`${source.url}-${idx}`}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          title={source.title || source.url}
          className={chipClass}
        >
          <SourceFavicon src={source.favicon} className="h-3.5 w-3.5" />
          <span className="truncate">{hostOf(source)}</span>
        </a>
      ))}

      {hidden.length > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={cn(chipClass, "cursor-pointer")}
        >
          <span className="flex items-center -space-x-1.5">
            {hidden.slice(0, STACKED_FAVICONS).map((source, idx) => (
              <span
                key={`${source.url}-stack-${idx}`}
                className="grid h-4 w-4 place-items-center rounded-full bg-[var(--panel)] ring-1 ring-[var(--panel)]"
              >
                <SourceFavicon src={source.favicon} className="h-3.5 w-3.5" />
              </span>
            ))}
          </span>
          <span className="shrink-0">{t("message.searchMoreSources", { count: hidden.length })}</span>
        </button>
      ) : null}
    </div>
  );
}

/** Sources of a run of web/deep searches, deduplicated by URL, in the order found. */
export function collectSearchSources(tools: ToolActivity[]): CompactWebSource[] {
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
  return allSources;
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

  const allSources = collectSearchSources(tools);

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

      {/* Site chips (favicon + host only), like the reference: up to 7, then "+N more" */}
      {isOpen && allSources.length > 0 ? (
        <div className="mt-2 ml-[7px] pl-4 border-l border-[var(--border)] py-1">
          <SourceChips sources={allSources} />
        </div>
      ) : null}
    </div>
  );
}
