"use client";

import React, { useState } from "react";
import { Wrench, CheckCircle2, AlertCircle, Loader2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import { InteractiveQuizWidget } from "./interactive-quiz-widget";
import { SearchActivityAccordion } from "./search-activity-accordion";
import type { ToolActivity } from "@/types";
import type { InteractiveQuizInput } from "@/lib/tools/interactive-quiz";

interface ToolActivityListProps {
  tools: ToolActivity[];
  messageId?: string;
  chatId?: string;
}

export function ToolActivityList({ tools, messageId, chatId }: ToolActivityListProps) {
  const { t } = useI18n();

  if (!tools || tools.length === 0) return null;

  // Group search tools (web_search, deep_search) together like Claude.ai
  const searchTools = tools.filter(
    (t) => t.name === "web_search" || t.name === "deep_search"
  );
  const otherTools = tools.filter(
    (t) => t.name !== "web_search" && t.name !== "deep_search"
  );

  return (
    <div className="mb-3 space-y-2">
      {/* 1. Grouped Search Accordion (matching Image 2) */}
      {searchTools.length > 0 ? (
        <SearchActivityAccordion tools={searchTools} />
      ) : null}

      {/* 2. Other tools (interactive_quiz widget or generic tools) */}
      {otherTools.map((tool) => {
        if (tool.name === "interactive_quiz" && tool.input) {
          return (
            <InteractiveQuizWidget
              key={tool.id}
              data={tool.input as InteractiveQuizInput}
              toolCallId={tool.id}
              messageId={messageId}
              chatId={chatId}
            />
          );
        }

        return <ToolActivityItem key={tool.id} tool={tool} t={t} />;
      })}
    </div>
  );
}

function ToolActivityItem({
  tool,
  t,
}: {
  tool: ToolActivity;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = tool.input !== undefined || tool.output !== undefined || Boolean(tool.error);

  const isRunning = tool.state === "running" || tool.state === "streaming";
  const isError = tool.state === "error";

  const label = isRunning
    ? t("message.toolRunning", { tool: tool.name })
    : isError
      ? t("message.toolFailed", { tool: tool.name })
      : t("message.toolDone", { tool: tool.name });

  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)]/30 overflow-hidden text-[12px]">
      <button
        type="button"
        disabled={!hasDetails}
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left select-none transition-colors",
          hasDetails ? "hover:bg-[var(--hover)]/50 cursor-pointer" : "cursor-default",
          isError ? "text-red-400" : "text-[var(--muted)]"
        )}
      >
        <span className="inline-flex items-center gap-2 truncate">
          {isRunning ? (
            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-[var(--accent)]" />
          ) : isError ? (
            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-400" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
          )}
          <span className="font-mono text-[11.5px] truncate">{label}</span>
        </span>

        {hasDetails ? (
          <ChevronDown
            className={cn(
              "w-3 h-3 shrink-0 text-[var(--muted)] transition-transform duration-150",
              expanded && "rotate-180"
            )}
          />
        ) : null}
      </button>

      {expanded && hasDetails ? (
        <div className="px-3 py-2 border-t border-[var(--border)]/40 bg-black/20 font-mono text-[11px] space-y-2 overflow-x-auto">
          {tool.input !== undefined ? (
            <div>
              <div className="text-[var(--muted)] text-[10px] uppercase tracking-wider mb-0.5">
                {t("message.toolInput")}
              </div>
              <pre className="text-[var(--ink)] whitespace-pre-wrap break-all bg-[var(--panel)]/60 p-2 rounded-[6px]">
                {typeof tool.input === "string"
                  ? tool.input
                  : JSON.stringify(tool.input, null, 2)}
              </pre>
            </div>
          ) : null}

          {tool.output !== undefined ? (
            <div>
              <div className="text-[var(--muted)] text-[10px] uppercase tracking-wider mb-0.5">
                {t("message.toolOutput")}
              </div>
              <pre className="text-[var(--ink)] whitespace-pre-wrap break-all bg-[var(--panel)]/60 p-2 rounded-[6px]">
                {typeof tool.output === "string"
                  ? tool.output
                  : JSON.stringify(tool.output, null, 2)}
              </pre>
            </div>
          ) : null}

          {tool.error ? (
            <div>
              <div className="text-red-400 text-[10px] uppercase tracking-wider mb-0.5">
                Error
              </div>
              <pre className="text-red-400 whitespace-pre-wrap break-all bg-red-500/10 p-2 rounded-[6px]">
                {tool.error}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
