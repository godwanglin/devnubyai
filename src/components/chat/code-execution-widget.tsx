"use client";

import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  ChevronRight,
  Loader2,
  RotateCw,
  Terminal,
} from "lucide-react";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { Tooltip } from "@/components/ui/tooltip";
import { useCodeExecution, type UseCodeExecutionOptions } from "@/hooks/use-code-execution";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";

export interface StandaloneChartFigure {
  title: string;
  url: string;
}

export interface CodeExecutionWidgetProps extends UseCodeExecutionOptions {
  /** When true, this tool is the sole item in the outer accordion so no inner toggle is needed */
  singleTool?: boolean;
  /** Lifts generated visual charts outside the collapsible code/tool block */
  onChartsChange?: (toolCallId: string, charts: StandaloneChartFigure[]) => void;
}

function wrapInMarkdownFence(code: string, language: string): string {
  const backticks = code.match(/`+/g) || [];
  const maxBackticks = backticks.reduce((max, b) => Math.max(max, b.length), 0);
  const fence = "`".repeat(Math.max(3, maxBackticks + 1));
  return `${fence}${language}\n${code}\n${fence}`;
}

export function CodeExecutionWidget({
  singleTool = false,
  onChartsChange,
  ...execProps
}: CodeExecutionWidgetProps) {
  const { t } = useI18n();
  const {
    title,
    language,
    code,
    effectivePhase,
    isBusy,
    isError,
    stdout,
    stderr,
    resultText,
    durationMs,
    charts,
    rerun,
  } = useCodeExecution(execProps);

  const [isOpen, setIsOpen] = useState(false);

  // Lift charts upward so ToolActivityList renders them outside the collapsible block
  useEffect(() => {
    onChartsChange?.(execProps.toolCallId, charts);
  }, [charts, execProps.toolCallId, onChartsChange]);

  const langLabel = language === "python" ? "Python" : "JavaScript";
  const statusText =
    effectivePhase === "streaming"
      ? t("codeExec.streamingCode")
      : effectivePhase === "loading_runtime"
        ? t("codeExec.loadingRuntime")
        : effectivePhase === "executing"
          ? t("codeExec.running")
          : isError
            ? t("codeExec.failed")
            : durationMs !== undefined
              ? `${(durationMs / 1000).toFixed(durationMs < 1000 ? 2 : 1)}s`
              : null;

  const hasTextOutput = Boolean(stdout || resultText || stderr);

  const codeAndConsoleBody = (
    <div className="space-y-2 pt-1 pb-1.5">
      <div className="flex items-center justify-between gap-2 text-[11.5px] text-[var(--muted)] font-mono select-none">
        <span>
          {langLabel} · WASM{statusText ? ` · ${statusText}` : ""}
        </span>
        <Tooltip content={t("codeExec.rerun")} side="top" align="end">
          <button
            type="button"
            disabled={isBusy || !code.trim()}
            onClick={rerun}
            className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] transition-colors",
              isBusy || !code.trim()
                ? "opacity-40 cursor-not-allowed"
                : "hover:bg-[var(--hover)] hover:text-[var(--ink)] cursor-pointer"
            )}
            aria-label={t("codeExec.rerun")}
          >
            <RotateCw className={cn("w-3 h-3", isBusy && "animate-spin")} />
            <span>{t("codeExec.rerun")}</span>
          </button>
        </Tooltip>
      </div>

      {code ? (
        <MarkdownRenderer
          content={wrapInMarkdownFence(code, language)}
          className="[&_.group]:!my-1 [&_pre]:!max-h-[300px] [&_pre]:!overflow-y-auto"
        />
      ) : null}

      {hasTextOutput ? (
        <div className="rounded-[8px] border border-[var(--border)]/70 bg-[var(--panel)]/60 px-3 py-2 font-mono text-[12px] leading-relaxed space-y-1.5 max-h-[220px] overflow-auto">
          {stdout ? (
            <pre className="whitespace-pre-wrap break-words text-[var(--ink)]">{stdout}</pre>
          ) : null}
          {resultText ? (
            <pre className="whitespace-pre-wrap break-words text-[var(--muted)]">
              {stdout ? `→ ${resultText}` : resultText}
            </pre>
          ) : null}
          {stderr ? (
            <pre className="whitespace-pre-wrap break-words text-red-400/90">{stderr}</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  if (singleTool) {
    return codeAndConsoleBody;
  }

  return (
    <div className="py-0.5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          aria-expanded={isOpen}
          className="group/exec inline-flex items-center gap-2 -ml-1.5 px-1.5 py-1 rounded-[7px] text-[13px] text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)] transition-colors cursor-pointer select-none min-w-0"
        >
          {isBusy ? (
            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-[var(--muted)]" />
          ) : isError ? (
            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-400/90" />
          ) : (
            <Terminal className="w-3.5 h-3.5 shrink-0 text-[var(--muted)]" />
          )}

          <span className="truncate font-medium">{title}</span>

          {statusText ? (
            <span className="font-mono text-[11px] text-[var(--muted)] shrink-0">
              ({statusText})
            </span>
          ) : null}

          <ChevronRight
            className={cn(
              "w-3.5 h-3.5 shrink-0 text-[var(--muted)] transition-transform duration-200",
              isOpen && "rotate-90"
            )}
          />
        </button>
      </div>

      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">{codeAndConsoleBody}</div>
      </div>
    </div>
  );
}
