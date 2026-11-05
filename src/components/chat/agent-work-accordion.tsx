"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronDown, Loader2, Wrench } from "lucide-react";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { cn } from "@/lib/cn";
import type { CompactWebSource } from "@/lib/tools/compact-source";
import { useI18n } from "@/providers/i18n-provider";
import type { MessageSegment, ToolActivity } from "@/types";
import type { StandaloneChartFigure } from "./code-execution-widget";
import { ThinkingAccordion } from "./thinking-accordion";
import { ToolActivityList } from "./tool-activity";
import {
  collectToolVisuals,
  mergeLiveCharts,
  ToolVisualGallery,
  type LiveChartsMap,
} from "./tool-visuals";

export interface AgentWorkAccordionProps {
  segments: MessageSegment[];
  tools: ToolActivity[];
  messageId: string;
  chatId?: string;
  isMessageStreaming?: boolean;
  isWorkActive: boolean;
  sourcesMap: Map<string, CompactWebSource>;
}

/**
 * Collapsible wrapper for an agent's multi-step work history (intro text, thoughts,
 * and tool executions) that precedes the final response.
 *
 * - Opens automatically (`isOpen = true`) while `isWorkActive` is true during live streaming.
 * - Auto-collapses (`isOpen = false`) as soon as `isWorkActive` transitions to false
 *   (i.e. when the final answer begins streaming or the turn completes).
 * - Summarizes the work as `Worked for 45s (N tools)` / `Worked for 11m 24s (N tools)`.
 * - Visual results (charts, generated images) are shown BELOW the drawer, so they stay
 *   visible in the conversation flow when the work history is collapsed.
 */

/** `45s`, `11m 24s`, `5m`, `1h 3m 9s` */
export function formatWorkDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours === 0 && minutes === 0) return `${seconds}s`;
  const parts = [hours > 0 ? `${hours}h` : "", minutes > 0 ? `${minutes}m` : "", seconds > 0 ? `${seconds}s` : ""];
  return parts.filter(Boolean).join(" ");
}
export function AgentWorkAccordion({
  segments,
  tools,
  messageId,
  chatId,
  isMessageStreaming = false,
  isWorkActive,
  sourcesMap,
}: AgentWorkAccordionProps) {
  const { t } = useI18n();

  const [isOpen, setIsOpen] = useState(Boolean(isWorkActive));
  const userInteractedRef = useRef(false);
  const wasWorkActiveRef = useRef(Boolean(isWorkActive));
  const workStartRef = useRef<number | null>(null);

  // Compute persisted duration from completed reasoning + tool segments
  const persistedDurationSec = useMemo(() => {
    let sum = 0;
    for (const seg of segments) {
      if (seg.type === "reasoning" && typeof seg.durationSec === "number") {
        sum += seg.durationSec;
      }
    }
    for (const tool of tools) {
      if (typeof tool.durationSec === "number") {
        sum += tool.durationSec;
      }
    }
    return Math.max(1, sum);
  }, [segments, tools]);

  const [liveSec, setLiveSec] = useState<number>(persistedDurationSec);
  const [liveChartsMap, setLiveChartsMap] = useState<LiveChartsMap>({});

  const handleChartsChange = useCallback(
    (toolCallId: string, nextCharts: StandaloneChartFigure[]) => {
      setLiveChartsMap((prev) => mergeLiveCharts(prev, toolCallId, nextCharts));
    },
    []
  );

  const visuals = useMemo(
    () => collectToolVisuals(tools, liveChartsMap, chatId),
    [tools, liveChartsMap, chatId]
  );

  useEffect(() => {
    if (isWorkActive) {
      wasWorkActiveRef.current = true;
      if (!userInteractedRef.current) {
        setIsOpen(true);
      }

      if (workStartRef.current === null) {
        const earliestToolStart = tools.reduce<number | null>((min, tool) => {
          if (typeof tool.startedAt === "number") {
            return min === null ? tool.startedAt : Math.min(min, tool.startedAt);
          }
          return min;
        }, null);
        workStartRef.current = earliestToolStart ?? Date.now();
      }

      const start = workStartRef.current;
      const tick = () => {
        const elapsed = Math.max(1, Math.round((Date.now() - start) / 1000));
        setLiveSec(Math.max(elapsed, persistedDurationSec));
      };
      tick();
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    }

    // Transition from active work -> final response / completed: auto-collapse
    if (wasWorkActiveRef.current && !userInteractedRef.current) {
      setIsOpen(false);
    }
  }, [isWorkActive, persistedDurationSec, tools]);

  function handleToggle() {
    userInteractedRef.current = true;
    setIsOpen((prev) => !prev);
  }

  const totalCount = tools.length;
  const failedCount = tools.filter((tool) => tool.state === "error").length;
  const displaySec = isWorkActive ? liveSec : persistedDurationSec;
  const duration = formatWorkDuration(displaySec);

  const headerLabel = isWorkActive
    ? totalCount === 1
      ? t("message.workingForOneTool", { duration })
      : t("message.workingForTools", { duration, count: totalCount })
    : totalCount === 1
      ? t("message.workedForOneTool", { duration })
      : t("message.workedForTools", { duration, count: totalCount });

  return (
    <div className="mb-3.5">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        className="group inline-flex items-center gap-2 -ml-1.5 px-1.5 py-1 rounded-[8px] text-[13.5px] font-medium cursor-pointer select-none transition-colors hover:bg-[var(--hover)]"
      >
        {isWorkActive ? (
          <Loader2 className="w-4 h-4 shrink-0 animate-spin text-[var(--muted)]" />
        ) : failedCount > 0 ? (
          <AlertCircle className="w-4 h-4 shrink-0 text-red-400/90" />
        ) : (
          <Wrench className="w-4 h-4 shrink-0 text-[var(--muted)]" />
        )}

        <span
          className={cn(
            "transition-colors",
            isWorkActive
              ? "text-shimmer"
              : "text-[var(--muted)] group-hover:text-[var(--ink)]"
          )}
        >
          {headerLabel}
        </span>

        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 shrink-0 text-[var(--muted)] transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {/* Smooth collapsible work history drawer */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <div className="mt-2 ml-[7px] pl-4 border-l border-[var(--border)] space-y-2.5">
            {segments.map((segment, idx) => {
              const isLastSeg = idx === segments.length - 1;
              if (segment.type === "tools") {
                return (
                  <ToolActivityList
                    key={`work-tools-${segment.tools[0]?.id ?? idx}`}
                    tools={segment.tools}
                    messageId={messageId}
                    chatId={chatId}
                    isMessageStreaming={isMessageStreaming}
                    onChartsChange={handleChartsChange}
                  />
                );
              }
              if (segment.type === "reasoning") {
                return (
                  <ThinkingAccordion
                    key={`work-reasoning-${idx}`}
                    content={segment.text}
                    durationSec={segment.durationSec}
                    isStreaming={isWorkActive && isLastSeg}
                  />
                );
              }
              return (
                <div
                  key={`work-text-${idx}`}
                  className={cn(
                    "prose-chat text-[14px] text-[var(--muted)]",
                    isWorkActive && isLastSeg && "typewriter-fade-in"
                  )}
                >
                  <MarkdownRenderer content={segment.text} sourcesMap={sourcesMap} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <ToolVisualGallery visuals={visuals} />
    </div>
  );
}
