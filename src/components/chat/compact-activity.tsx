"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Brain, Globe, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import type { InteractiveQuizInput } from "@/lib/tools/interactive-quiz";
import type { ToolActivity } from "@/types";
import { CodeExecutionWidget, type StandaloneChartFigure } from "./code-execution-widget";
import { InteractiveQuizWidget } from "./interactive-quiz-widget";
import { collectSearchSources } from "./search-activity-accordion";
import { describeTool, isRunningTool, isSearchTool, ToolGlyph } from "./tool-activity";
import {
  collectToolVisuals,
  mergeLiveCharts,
  ToolVisualGallery,
  type LiveChartsMap,
} from "./tool-visuals";

/**
 * Work views for the "normal" and "silent" response modes (see `useResponseMode`):
 * single lines with nothing to expand. "verbose" keeps the full accordions.
 */

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Seconds since `active` turned on (at least 1), ticking every second; null before. */
function useLiveSeconds(active: boolean): number | null {
  const startRef = useRef<number | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    if (startRef.current === null) startRef.current = Date.now();
    const start = startRef.current;
    const tick = () => setSeconds(Math.max(1, Math.round((Date.now() - start) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active]);
  return seconds;
}

/** The newest line of streaming thoughts, without markdown markers. */
function latestLine(content: string): string {
  const lines = content
    .split("\n")
    .map((line) =>
      line
        .replace(/^[\s#>*\-+`\d.]+(?=\S)/, "")
        .replace(/\*\*|__|`/g, "")
        .trim()
    )
    .filter(Boolean);
  return lines.at(-1) ?? "";
}

/** "Searching the web…" while running, "Searched 10 web sources" once done, else the tool's own label. */
export function compactToolLabel(tools: ToolActivity[], t: Translate): string {
  const search = tools.filter(isSearchTool);
  if (search.length === tools.length && search.length > 0) {
    const deep = search.some((tool) => tool.name === "deep_search");
    if (search.some(isRunningTool)) return deep ? t("message.deepSearching") : t("message.searchingWeb");
    const count = collectSearchSources(search).length;
    if (count > 0) return t("message.searchedWebCount", { count });
    return deep ? t("message.doneDeepSearch") : t("message.searchedTheWeb");
  }
  return describeTool(tools[tools.length - 1], t);
}

function ToolLineIcon({ tools, className }: { tools: ToolActivity[]; className?: string }) {
  const last = tools[tools.length - 1];
  if (tools.some(isRunningTool)) {
    return <Loader2 className={cn(className, "animate-spin text-[var(--muted)]")} />;
  }
  if (tools.every((tool) => tool.state === "error")) {
    return <AlertCircle className={cn(className, "text-red-400/90")} />;
  }
  if (tools.every(isSearchTool)) return <Globe className={cn(className, "text-[var(--muted)]")} />;
  return <ToolGlyph name={last.name} tool={last} className={cn(className, "text-[var(--muted)]")} />;
}

/**
 * Normal mode thinking: one line. "Thinking..." until thoughts arrive, then the newest
 * line of them (replaced as they stream), then "Thought for Xs".
 */
export function CompactThinkingLine({
  content,
  durationSec,
  isStreaming,
}: {
  content: string;
  durationSec?: number;
  isStreaming?: boolean;
}) {
  const { t } = useI18n();
  const liveSeconds = useLiveSeconds(Boolean(isStreaming));
  const seconds = durationSec ?? liveSeconds;

  const label = isStreaming
    ? latestLine(content) || t("message.thinkingLine")
    : seconds !== null
      ? t("message.thoughtFor", { seconds })
      : t("message.thoughtProcess");

  return (
    <div className="mb-3 flex min-w-0 items-center gap-2 text-[13.5px] font-medium select-none">
      <Brain
        className={cn("w-4 h-4 shrink-0 text-[var(--accent)]", isStreaming && "animate-pulse")}
        aria-hidden="true"
      />
      <span className={cn("min-w-0 truncate", isStreaming ? "text-shimmer" : "text-[var(--muted)]")}>
        {label}
      </span>
    </div>
  );
}

/** Normal mode tools: a plain list, one line per tool (searches grouped), nothing to expand. */
export function CompactToolList({ tools }: { tools: ToolActivity[] }) {
  const { t } = useI18n();
  const searchTools = tools.filter(isSearchTool);
  const rows: { key: string; tools: ToolActivity[] }[] = [];
  if (searchTools.length > 0) rows.push({ key: `search-${searchTools[0].id}`, tools: searchTools });
  for (const tool of tools) {
    if (!isSearchTool(tool)) rows.push({ key: tool.id, tools: [tool] });
  }
  if (rows.length === 0) return null;

  return (
    <div className="mb-3 space-y-1">
      {rows.map((row) => {
        const running = row.tools.some(isRunningTool);
        const failed = !running && row.tools.every((tool) => tool.state === "error");
        return (
          <div key={row.key} className="flex min-w-0 items-center gap-2 text-[13.5px] select-none">
            <ToolLineIcon tools={row.tools} className="w-4 h-4 shrink-0" />
            <span
              className={cn(
                "min-w-0 truncate",
                running ? "text-shimmer" : failed ? "text-red-400/90" : "text-[var(--muted)]"
              )}
            >
              {compactToolLabel(row.tools, t)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The call(s) the status line is about: a running one if any, else the latest (searches together). */
function pickActiveTools(tools: ToolActivity[]): ToolActivity[] {
  const running = tools.filter(isRunningTool);
  const pool = running.length > 0 ? running : tools;
  const last = pool[pool.length - 1];
  return isSearchTool(last) ? pool.filter(isSearchTool) : [last];
}

/**
 * Silent mode: one status line for all the work, replaced as it goes ("Thinking · 4s",
 * then "Generating image…", then "Searching the web…"). Gone once the answer starts.
 */
export function SilentStatusLine({ tools }: { tools: ToolActivity[] | null }) {
  const { t } = useI18n();
  const seconds = useLiveSeconds(true);
  const activeTools = tools?.length ? pickActiveTools(tools) : null;

  if (activeTools && activeTools.length > 0) {
    return (
      <div className="flex min-w-0 items-center gap-2 py-1 text-[13.5px] font-medium select-none" role="status">
        <ToolLineIcon tools={activeTools} className="w-4 h-4 shrink-0" />
        <span className="min-w-0 truncate text-shimmer">{compactToolLabel(activeTools, t)}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-1 text-[13.5px] font-medium select-none" role="status">
      <Brain className="w-4 h-4 shrink-0 text-[var(--accent)] animate-pulse" aria-hidden="true" />
      <span className="text-shimmer">
        {seconds !== null ? t("message.thinkingLive", { seconds }) : t("message.thinkingLine")}
      </span>
    </div>
  );
}

/**
 * What the tool traces carried besides the trace itself: charts, generated images and
 * quizzes stay visible, and `execute_code` keeps running (it executes in the browser
 * and saves its result) in a hidden widget.
 */
export function ToolResults({
  tools,
  messageId,
  chatId,
  isMessageStreaming,
}: {
  tools: ToolActivity[];
  messageId: string;
  chatId?: string;
  isMessageStreaming?: boolean;
}) {
  const [liveChartsMap, setLiveChartsMap] = useState<LiveChartsMap>({});
  const handleChartsChange = useCallback((toolCallId: string, charts: StandaloneChartFigure[]) => {
    setLiveChartsMap((prev) => mergeLiveCharts(prev, toolCallId, charts));
  }, []);
  const visuals = useMemo(
    () => collectToolVisuals(tools, liveChartsMap, chatId),
    [tools, liveChartsMap, chatId]
  );

  const codeTools = tools.filter((tool) => tool.name === "execute_code");
  const quizTools = tools.filter((tool) => tool.name === "interactive_quiz" && Boolean(tool.input));

  return (
    <>
      {codeTools.length > 0 ? (
        <div className="hidden" aria-hidden="true">
          {codeTools.map((tool) => (
            <CodeExecutionWidget
              key={tool.id}
              input={tool.input}
              output={tool.output}
              toolState={tool.state}
              toolCallId={tool.id}
              messageId={messageId}
              chatId={chatId}
              isMessageStreaming={isMessageStreaming}
              singleTool
              onChartsChange={handleChartsChange}
            />
          ))}
        </div>
      ) : null}
      <ToolVisualGallery visuals={visuals} />
      {quizTools.map((tool) => (
        <InteractiveQuizWidget
          key={tool.id}
          data={tool.input as InteractiveQuizInput}
          toolCallId={tool.id}
          messageId={messageId}
          chatId={chatId}
        />
      ))}
    </>
  );
}
