"use client";

import React, { useCallback, useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  FileCode,
  FileText,
  Globe,
  Hash,
  HelpCircle,
  Image as ImageIcon,
  Loader2,
  NotebookPen,
  Terminal,
  Wrench,
} from "lucide-react";
import {
  ImagePreviewModal,
  type PreviewImageTarget,
} from "@/components/modals/image-preview-modal";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import type { InteractiveQuizInput } from "@/lib/tools/interactive-quiz";
import type { ToolActivity } from "@/types";
import {
  CodeExecutionWidget,
  type StandaloneChartFigure,
} from "./code-execution-widget";
import { InteractiveQuizWidget } from "./interactive-quiz-widget";
import { SearchActivityAccordion } from "./search-activity-accordion";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface ToolActivityListProps {
  tools: ToolActivity[];
  messageId?: string;
  chatId?: string;
  isMessageStreaming?: boolean;
}

const isSearchTool = (tool: ToolActivity) =>
  tool.name === "web_search" || tool.name === "deep_search";
const isRunningTool = (tool: ToolActivity) =>
  tool.state === "running" || tool.state === "streaming";

function baseName(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.split(/[\\/]/).pop() || fallback;
}

/** Formats tool call details into human-friendly label (e.g. "Membaca data.csv#1-100") */
function describeTool(tool: ToolActivity, t: Translate): string {
  const input = (tool.input && typeof tool.input === "object" ? tool.input : {}) as Record<
    string,
    unknown
  >;

  switch (tool.name) {
    case "read_file": {
      const start = typeof input.startLine === "number" ? input.startLine : 1;
      const max = typeof input.maxLines === "number" ? input.maxLines : 100;
      const target = `${baseName(input.filename, "file")}#${start}-${start + max - 1}`;
      return t("message.toolReadFile", { target });
    }
    case "write_file":
      return t("message.toolWriteFile", { target: baseName(input.filename, "file") });
    case "edit_file":
      return t("message.toolEditFile", {
        target: baseName(input.filename || input.fileId, "file"),
      });
    case "vision_tool":
      return t("message.toolVision", { target: baseName(input.filename, "image") });
    case "execute_code": {
      if (typeof input.title === "string" && input.title.trim()) {
        return input.title.trim();
      }
      return t("message.toolExecuteCode", {
        target: typeof input.language === "string" ? input.language : "code",
      });
    }
    case "interactive_quiz":
      return t("message.toolQuiz");
    case "calculate":
      return t("message.toolCalculate", { target: String(input.expression ?? "expr").slice(0, 40) });
    case "fetch_url":
      return t("message.toolFetchUrl", { target: baseName(input.url, "url") });
    case "memory_note":
      return t("message.toolMemoryNote", { action: String(input.action ?? "") });
    case "web_search":
    case "deep_search":
      return t("message.doneWebSearch");
    default:
      return t("message.toolDone", { tool: tool.name });
  }
}

function ToolGlyph({ name, className }: { name?: string; className?: string }) {
  switch (name) {
    case "read_file":
      return <FileText className={className} />;
    case "write_file":
    case "edit_file":
      return <FileCode className={className} />;
    case "vision_tool":
      return <ImageIcon className={className} />;
    case "execute_code":
      return <Terminal className={className} />;
    case "interactive_quiz":
      return <HelpCircle className={className} />;
    case "calculate":
      return <Hash className={className} />;
    case "fetch_url":
      return <Globe className={className} />;
    case "memory_note":
      return <NotebookPen className={className} />;
    default:
      return <Wrench className={className} />;
  }
}

function extractPersistedCharts(output: unknown): StandaloneChartFigure[] {
  if (!output || typeof output !== "object") return [];
  const exec = (output as Record<string, unknown>).executionResult;
  if (!exec || typeof exec !== "object") return [];
  const charts = (exec as Record<string, unknown>).charts;
  if (!Array.isArray(charts)) return [];
  return charts
    .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === "object" && c.url))
    .map((c, idx) => ({
      url: String(c.url),
      title: String(c.title || `Chart ${idx + 1}`),
    }));
}

function extractDiffStats(tool: ToolActivity): { added: number; removed: number } | null {
  const output = (tool.output && typeof tool.output === "object" ? tool.output : {}) as Record<
    string,
    unknown
  >;
  const data = (output.data && typeof output.data === "object" ? output.data : output) as Record<
    string,
    unknown
  >;

  if (data.linesChanged && typeof data.linesChanged === "object") {
    const lc = data.linesChanged as Record<string, unknown>;
    const added = typeof lc.added === "number" ? lc.added : 0;
    const removed = typeof lc.removed === "number" ? lc.removed : 0;
    return { added, removed };
  }

  // Fallback for write_file if output doesn't have linesChanged yet
  if (tool.name === "write_file") {
    const input = (tool.input && typeof tool.input === "object" ? tool.input : {}) as Record<
      string,
      unknown
    >;
    if (typeof input.content === "string") {
      return { added: input.content.split("\n").length, removed: 0 };
    }
  }

  return null;
}

function DiffBadge({ stats }: { stats: { added: number; removed: number } }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] px-1.5 py-0.5 rounded-[4px] bg-white/[0.06] border border-white/10 shrink-0 select-none">
      <span className="text-emerald-400 font-semibold">+{stats.added}</span>
      <span className="text-red-400/80 font-semibold">-{stats.removed}</span>
    </span>
  );
}

/**
 * Borderless "Thought for Xs"-style tool activity accordion with soft monochrome icons.
 * Visual previews (charts from `execute_code`, interactive quizzes) are rendered OUTSIDE
 * the collapsible trace so they remain directly visible in the conversation flow.
 */
export function ToolActivityList({
  tools,
  messageId,
  chatId,
  isMessageStreaming = false,
}: ToolActivityListProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [liveChartsMap, setLiveChartsMap] = useState<Record<string, StandaloneChartFigure[]>>({});
  const [previewImage, setPreviewImage] = useState<PreviewImageTarget | null>(null);

  const handleChartsChange = useCallback(
    (toolCallId: string, nextCharts: StandaloneChartFigure[]) => {
      setLiveChartsMap((prev) => {
        const current = prev[toolCallId];
        if (
          current &&
          current.length === nextCharts.length &&
          current.every((c, idx) => c.url === nextCharts[idx]?.url)
        ) {
          return prev;
        }
        return { ...prev, [toolCallId]: nextCharts };
      });
    },
    []
  );

  const standaloneCharts = useMemo(() => {
    const out: StandaloneChartFigure[] = [];
    for (const tool of tools) {
      if (tool.name !== "execute_code") continue;
      const fromLive = liveChartsMap[tool.id];
      const charts = fromLive !== undefined ? fromLive : extractPersistedCharts(tool.output);
      for (const ch of charts) {
        if (ch.url) out.push(ch);
      }
    }
    return out;
  }, [tools, liveChartsMap]);

  if (!tools || tools.length === 0) return null;

  const searchTools = tools.filter(isSearchTool);
  const otherTools = tools.filter((tool) => !isSearchTool(tool));

  // If the turn ONLY used web/deep search, render SearchActivityAccordion directly (no double toggle)
  if (otherTools.length === 0) {
    return <SearchActivityAccordion tools={searchTools} />;
  }

  const isRunning = tools.some(isRunningTool);
  const failedCount = tools.filter((tool) => tool.state === "error").length;
  const totalDuration = tools.reduce((sum, tool) => sum + (tool.durationSec ?? 0), 0);

  const title =
    tools.length === 1
      ? describeTool(tools[0], t)
      : isRunning
        ? t("message.toolsRunning", { count: tools.length })
        : t("message.toolsUsed", { count: tools.length });

  const quizTools = otherTools.filter(
    (tool) => tool.name === "interactive_quiz" && Boolean(tool.input)
  );

  return (
    <>
      <div className="mb-3">
        {/* Borderless trigger matching ThinkingAccordion ("Thought for Xs") */}
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          aria-expanded={isOpen}
          className="group inline-flex items-center gap-2 -ml-1.5 px-1.5 py-1 rounded-[8px] text-[13.5px] font-medium cursor-pointer select-none transition-colors hover:bg-[var(--hover)]"
        >
          {isRunning ? (
            <Loader2 className="w-4 h-4 shrink-0 animate-spin text-[var(--muted)]" />
          ) : failedCount > 0 ? (
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400/90" />
          ) : (
            <ToolGlyph
              name={tools.length === 1 ? tools[0].name : undefined}
              className="w-4 h-4 shrink-0 text-[var(--muted)]"
            />
          )}

          <span
            className={cn(
              "transition-colors truncate max-w-[260px] sm:max-w-[440px]",
              isRunning
                ? "text-shimmer"
                : "text-[var(--muted)] group-hover:text-[var(--ink)]"
            )}
          >
            {title}
          </span>

          {tools.length === 1 && (() => {
            const stats = extractDiffStats(tools[0]);
            return stats ? <DiffBadge stats={stats} /> : null;
          })()}

          {failedCount > 0 && tools.length > 1 ? (
            <span className="text-[11.5px] text-red-400/90 shrink-0">
              {t("message.toolsFailedCount", { count: failedCount })}
            </span>
          ) : null}

          {!isRunning && totalDuration > 0 ? (
            <span className="font-mono text-[11.5px] text-[var(--muted)] shrink-0">
              ({totalDuration}s)
            </span>
          ) : null}

          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 shrink-0 text-[var(--muted)] transition-transform duration-200",
              isOpen && "rotate-180"
            )}
          />
        </button>

        {/* Smooth grid-rows drawer — stays mounted so WASM code executes automatically */}
        <div
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
            isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          )}
        >
          <div className="overflow-hidden">
            <div className="mt-1.5 ml-[7px] pl-4 border-l border-[var(--border)] space-y-1">
              {searchTools.length > 0 ? (
                <SearchActivityAccordion tools={searchTools} embedded />
              ) : null}

              {otherTools.map((tool) => {
                if (tool.name === "execute_code") {
                  return (
                    <CodeExecutionWidget
                      key={tool.id}
                      input={tool.input}
                      output={tool.output}
                      toolState={tool.state}
                      toolCallId={tool.id}
                      messageId={messageId}
                      chatId={chatId}
                      isMessageStreaming={isMessageStreaming}
                      singleTool={tools.length === 1}
                      onChartsChange={handleChartsChange}
                    />
                  );
                }

                return <ToolActivityRow key={tool.id} tool={tool} t={t} />;
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Standalone Visual Charts from `execute_code` — rendered OUTSIDE the tool block */}
      {standaloneCharts.length > 0 ? (
        <div
          className={cn(
            "my-3.5 grid gap-3",
            standaloneCharts.length > 1 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"
          )}
        >
          {standaloneCharts.map((chart, idx) => (
            <button
              key={`${chart.url}-${idx}`}
              type="button"
              onClick={() => setPreviewImage({ url: chart.url, title: chart.title })}
              className="block w-full max-w-[680px] rounded-[12px] border border-[var(--border)] bg-white p-2.5 overflow-hidden cursor-zoom-in transition-opacity hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-[var(--border)]"
              aria-label={chart.title}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={chart.url}
                alt={chart.title}
                className="w-full max-h-[420px] object-contain mx-auto rounded-[6px]"
              />
            </button>
          ))}
        </div>
      ) : null}

      {/* Standalone Interactive Quizzes — rendered OUTSIDE the tool block */}
      {quizTools.map((tool) => (
        <InteractiveQuizWidget
          key={tool.id}
          data={tool.input as InteractiveQuizInput}
          toolCallId={tool.id}
          messageId={messageId}
          chatId={chatId}
        />
      ))}

      <ImagePreviewModal
        image={previewImage}
        onClose={() => setPreviewImage(null)}
      />
    </>
  );
}

/** Borderless soft monochrome trace row for tools like read_file, write_file, vision_tool */
function ToolActivityRow({ tool, t }: { tool: ToolActivity; t: Translate }) {
  const isRunning = isRunningTool(tool);
  const isError = tool.state === "error";

  return (
    <div className="flex items-center gap-2 py-1 text-[13px] select-none">
      {isRunning ? (
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-[var(--muted)]" />
      ) : isError ? (
        <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-400/90" />
      ) : (
        <ToolGlyph name={tool.name} className="w-3.5 h-3.5 shrink-0 text-[var(--muted)]" />
      )}
      <span
        className={cn(
          "truncate",
          isError ? "text-red-400/90" : "text-[var(--muted)]"
        )}
      >
        {describeTool(tool, t)}
      </span>
      {(() => {
        const stats = extractDiffStats(tool);
        return stats ? <DiffBadge stats={stats} /> : null;
      })()}
      {!isRunning && tool.durationSec !== undefined && tool.durationSec > 0 ? (
        <span className="font-mono text-[11px] text-[var(--muted)]/80 shrink-0">
          ({tool.durationSec}s)
        </span>
      ) : null}
    </div>
  );
}
