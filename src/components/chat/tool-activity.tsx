"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle, BookOpen, ChevronDown, FileCode, FileText, Globe,
  Hash, HelpCircle, History, Image as ImageIcon, Loader2, NotebookPen,
  Terminal, Wrench,
} from "lucide-react";
import {
  FaRegFileExcel,
  FaRegFilePdf,
  FaRegFilePowerpoint,
  FaRegFileWord,
} from "react-icons/fa6";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { cn } from "@/lib/cn";
import { useAccount } from "@/providers/account-provider";
import { useI18n } from "@/providers/i18n-provider";
import type { InteractiveQuizInput } from "@/lib/tools/interactive-quiz";
import type { ToolActivity } from "@/types";
import { CodeExecutionWidget, type StandaloneChartFigure } from "./code-execution-widget";
import { InteractiveQuizWidget } from "./interactive-quiz-widget";
import { SearchActivityAccordion } from "./search-activity-accordion";
import {
  collectToolVisuals,
  mergeLiveCharts,
  ToolVisualGallery,
  type LiveChartsMap,
} from "./tool-visuals";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface ToolActivityListProps {
  tools: ToolActivity[];
  messageId?: string;
  chatId?: string;
  isMessageStreaming?: boolean;
  /**
   * When set, live charts are reported to the parent and no gallery is rendered here —
   * the parent (e.g. AgentWorkAccordion) shows the visuals outside its collapsible drawer.
   */
  onChartsChange?: (toolCallId: string, charts: StandaloneChartFigure[]) => void;
}

const isSearchTool = (tool: ToolActivity) =>
  tool.name === "web_search" || tool.name === "deep_search";
const isRunningTool = (tool: ToolActivity) =>
  tool.state === "running" || tool.state === "streaming";

function baseName(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.split(/[\\/]/).pop() || fallback;
}

/** Mirrors the Office tools, which append the extension when the model omits it. */
function officeFilename(value: unknown, extension: string): string {
  const name = baseName(value, "");
  if (!name) return extension.slice(1).toUpperCase();
  return name.toLowerCase().endsWith(extension) ? name : `${name}${extension}`;
}

// Maps known helper script basenames in .devnuby/skills/<skill>/scripts/ to i18n keys.
const SKILL_HELPER_SCRIPT_I18N: Record<string, string> = {
  "convert_pdf_to_images.py": "message.skillScriptConvertPdfImages",
  "check_fillable_fields.py": "message.skillScriptCheckFillable",
  "extract_form_field_info.py": "message.skillScriptExtractFields",
  "extract_form_structure.py": "message.skillScriptExtractStructure",
  "check_bounding_boxes.py": "message.skillScriptCheckBoxes",
  "fill_fillable_fields.py": "message.skillScriptFillPdf",
  "fill_pdf_form_with_annotations.py": "message.skillScriptFillPdf",
  "create_validation_image.py": "message.skillScriptValidationImage",
  "recalc.py": "message.skillScriptRecalcXlsx",
  "validate.py": "message.skillScriptValidateDoc",
  "soffice.py": "message.skillScriptConvertDoc",
  "comment.py": "message.skillScriptCommentDoc",
  "accept_changes.py": "message.skillScriptAcceptChanges",
  "merge_runs.py": "message.skillScriptMergeRuns",
  "thumbnail.py": "message.skillScriptSlideThumbnails",
  "add_slide.py": "message.skillScriptAddSlide",
  "clean.py": "message.skillScriptCleanAssets",
  "unpack.py": "message.skillScriptProcessPackage",
  "pack.py": "message.skillScriptProcessPackage",
};

/** Attempts to extract the primary document filename from `run_skill_script` output or inline code. */
function extractSkillTargetFilename(tool: ToolActivity): string | null {
  const outObj =
    tool.output && typeof tool.output === "object"
      ? (tool.output as Record<string, unknown>)
      : {};
  const dataObj =
    outObj.data && typeof outObj.data === "object"
      ? (outObj.data as Record<string, unknown>)
      : outObj;
  const genFiles = Array.isArray(dataObj.generatedFiles)
    ? (dataObj.generatedFiles as Array<Record<string, unknown>>)
    : [];
  for (const gf of genFiles) {
    const name = String(gf.displayName || gf.filename || "").trim();
    if (/\.(pdf|docx|dotx|xlsx|xlsm|pptx|potx|csv)$/i.test(name)) {
      return baseName(name, name);
    }
  }

  const inObj =
    tool.input && typeof tool.input === "object"
      ? (tool.input as Record<string, unknown>)
      : {};
  if (typeof inObj.code === "string") {
    const match = inObj.code.match(
      /['"]([a-zA-Z0-9_\-. ]+\.(?:pdf|docx|xlsx|pptx))['"]/i
    );
    if (match?.[1]) {
      return baseName(match[1].trim(), match[1].trim());
    }
  }
  return null;
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
    case "create_document": {
      const rawName = String(input.filename || "");
      const ext =
        rawName.toLowerCase().endsWith(".pdf") || input.format === "pdf"
          ? ".pdf"
          : ".docx";
      return t("message.toolCreateDocument", { target: officeFilename(input.filename, ext) });
    }
    case "create_spreadsheet":
      return t("message.toolCreateSpreadsheet", { target: officeFilename(input.filename, ".xlsx") });
    case "create_presentation":
      return t("message.toolCreatePresentation", { target: officeFilename(input.filename, ".pptx") });
    case "generate_image":
      return t("message.toolGenerateImage", { target: String(input.prompt || "gambar").slice(0, 30) });
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
    case "exec_command": {
      if (typeof input.description === "string" && input.description.trim()) {
        return input.description.trim().slice(0, 80);
      }
      return t("message.toolExecCommand");
    }
    case "interactive_quiz":
      return t("message.toolQuiz");
    case "calculate":
      return t("message.toolCalculate", { target: String(input.expression ?? "expr").slice(0, 40) });
    case "fetch_url":
      return t("message.toolFetchUrl", { target: baseName(input.url, "url") });
    case "memory_note":
      return t("message.toolMemoryNote", { action: String(input.action ?? "") });
    case "search_past_chats":
      return t("message.toolSearchPastChats", { target: String(input.query ?? "").slice(0, 40) });
    case "load_skill": {
      const skillName = String(input.name || "").trim().toLowerCase();
      const subFile = String(input.file || "").trim().toLowerCase();
      if (skillName === "pdf" && subFile.includes("form")) {
        return t("message.skillLoadPdfForms");
      }
      if (skillName === "pdf") return t("message.skillLoadPdf");
      if (skillName === "docx") return t("message.skillLoadDocx");
      if (skillName === "xlsx") return t("message.skillLoadXlsx");
      if (skillName === "pptx") return t("message.skillLoadPptx");
      return t("message.skillLoadGeneric", {
        skill: skillName ? skillName.toUpperCase() : "AI",
      });
    }
    case "run_skill_script": {
      const skillName = String(input.skill || "").trim().toLowerCase();
      if (typeof input.script === "string" && input.script.trim()) {
        const scriptBase = baseName(input.script.trim(), "").toLowerCase();
        const mappedKey = SKILL_HELPER_SCRIPT_I18N[scriptBase];
        if (mappedKey) {
          return t(mappedKey);
        }
      }
      const targetFile = extractSkillTargetFilename(tool);
      if (skillName === "pdf") {
        return targetFile
          ? t("message.skillBuildPdfFile", { target: targetFile })
          : t("message.skillBuildPdf");
      }
      if (skillName === "docx") {
        return targetFile
          ? t("message.skillBuildDocxFile", { target: targetFile })
          : t("message.skillBuildDocx");
      }
      if (skillName === "xlsx") {
        return targetFile
          ? t("message.skillBuildXlsxFile", { target: targetFile })
          : t("message.skillBuildXlsx");
      }
      if (skillName === "pptx") {
        return targetFile
          ? t("message.skillBuildPptxFile", { target: targetFile })
          : t("message.skillBuildPptx");
      }
      return t("message.skillBuildGeneric", {
        skill: skillName ? skillName.toUpperCase() : "AI",
      });
    }
    case "web_search":
    case "deep_search":
      return t("message.doneWebSearch");
    default:
      return t("message.toolDone", { tool: tool.name });
  }
}

function ToolGlyph({
  name,
  tool,
  className,
}: {
  name?: string;
  tool?: ToolActivity;
  className?: string;
}) {
  switch (name) {
    case "read_file": return <FileText className={className} />;
    case "create_document": {
      const input =
        tool?.input && typeof tool.input === "object"
          ? (tool.input as Record<string, unknown>)
          : {};
      const rawName = String(input.filename || "").toLowerCase();
      if (rawName.endsWith(".pdf") || input.format === "pdf") {
        return <FaRegFilePdf className={className} />;
      }
      return <FaRegFileWord className={className} />;
    }
    case "write_file":
    case "edit_file": return <FileCode className={className} />;
    case "create_spreadsheet": return <FaRegFileExcel className={className} />;
    case "create_presentation": return <FaRegFilePowerpoint className={className} />;
    case "generate_image":
    case "vision_tool": return <ImageIcon className={className} />;
    case "execute_code":
    case "exec_command": return <Terminal className={className} />;
    case "interactive_quiz": return <HelpCircle className={className} />;
    case "calculate": return <Hash className={className} />;
    case "fetch_url": return <Globe className={className} />;
    case "search_past_chats": return <History className={className} />;
    case "memory_note": return <NotebookPen className={className} />;
    case "load_skill": {
      const input =
        tool?.input && typeof tool.input === "object"
          ? (tool.input as Record<string, unknown>)
          : {};
      const skill = String(input.name || "").toLowerCase();
      if (skill === "pdf") return <FaRegFilePdf className={className} />;
      if (skill === "docx") return <FaRegFileWord className={className} />;
      if (skill === "xlsx") return <FaRegFileExcel className={className} />;
      if (skill === "pptx") return <FaRegFilePowerpoint className={className} />;
      return <BookOpen className={className} />;
    }
    case "run_skill_script": {
      const input =
        tool?.input && typeof tool.input === "object"
          ? (tool.input as Record<string, unknown>)
          : {};
      const skill = String(input.skill || "").toLowerCase();
      const script = String(input.script || "").toLowerCase();
      if (
        script.includes("image") ||
        script.includes("thumbnail")
      ) {
        return <ImageIcon className={className} />;
      }
      if (skill === "pdf") return <FaRegFilePdf className={className} />;
      if (skill === "docx") return <FaRegFileWord className={className} />;
      if (skill === "xlsx") return <FaRegFileExcel className={className} />;
      if (skill === "pptx") return <FaRegFilePowerpoint className={className} />;
      return <Wrench className={className} />;
    }
    default: return <Wrench className={className} />;
  }
}

function extractDiffStats(tool: ToolActivity): { added: number; removed: number } | null {
  const output = (tool.output && typeof tool.output === "object" ? tool.output : {}) as Record<string, unknown>;
  const data = (output.data && typeof output.data === "object" ? output.data : output) as Record<string, unknown>;

  if (data.linesChanged && typeof data.linesChanged === "object") {
    const lc = data.linesChanged as Record<string, unknown>;
    const added = typeof lc.added === "number" ? lc.added : 0;
    const removed = typeof lc.removed === "number" ? lc.removed : 0;
    return { added, removed };
  }

  const input = (tool.input && typeof tool.input === "object" ? tool.input : {}) as Record<string, unknown>;
  // Live streaming fallback for write_file & edit_file before output.linesChanged arrives
  if (tool.name === "write_file" && typeof input.content === "string" && input.content.length > 0) {
    return { added: input.content.split("\n").length, removed: 0 };
  }
  if (tool.name === "edit_file") {
    const added = typeof input.replacementText === "string" && input.replacementText.length > 0
      ? input.replacementText.split("\n").length
      : 0;
    const removed = typeof input.targetText === "string" && input.targetText.length > 0
      ? input.targetText.split("\n").length
      : 0;
    if (added > 0 || removed > 0) return { added, removed };
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
  onChartsChange,
}: ToolActivityListProps) {
  const { t } = useI18n();
  const { user } = useAccount();
  const toolDebug = Boolean(user?.toolDebug);
  const [isOpen, setIsOpen] = useState(false);
  const [liveChartsMap, setLiveChartsMap] = useState<LiveChartsMap>({});

  const handleLocalChartsChange = useCallback(
    (toolCallId: string, nextCharts: StandaloneChartFigure[]) => {
      setLiveChartsMap((prev) => mergeLiveCharts(prev, toolCallId, nextCharts));
    },
    []
  );
  const handleChartsChange = onChartsChange ?? handleLocalChartsChange;

  const standaloneVisuals = useMemo(
    () => (onChartsChange ? [] : collectToolVisuals(tools, liveChartsMap, chatId)),
    [onChartsChange, tools, liveChartsMap, chatId]
  );

  const isRunning = (tools ?? []).some(isRunningTool);

  // Live total duration calculation for running tools (hooks stay above the early returns)
  const [liveTotalDuration, setLiveTotalDuration] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const tick = () => {
      const now = Date.now();
      const sum = tools.reduce((acc, tool) => {
        if (tool.state === "completed" || tool.state === "error") {
          return acc + (tool.durationSec ?? 0);
        }
        const start = tool.startedAt ?? now;
        return acc + Math.max(1, Math.round((now - start) / 1000));
      }, 0);
      setLiveTotalDuration(sum);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isRunning, tools]);

  if (!tools || tools.length === 0) return null;

  const searchTools = tools.filter(isSearchTool);
  const otherTools = tools.filter((tool) => !isSearchTool(tool));

  // If the turn ONLY used web/deep search, render SearchActivityAccordion directly (no double toggle)
  if (otherTools.length === 0) {
    return <SearchActivityAccordion tools={searchTools} />;
  }

  const failedCount = tools.filter((tool) => tool.state === "error").length;

  const totalDuration = isRunning
    ? liveTotalDuration
    : tools.reduce((sum, tool) => sum + (tool.durationSec ?? 0), 0);

  const title =
    tools.length === 1
      ? describeTool(tools[0], t)
      : isRunning
        ? t("message.toolsRunning", { count: tools.length })
        : t("message.toolsUsed", { count: tools.length });

  const singleErrorText =
    toolDebug && tools.length === 1 && tools[0].state === "error" && tools[0].error
      ? tools[0].error
      : null;
  const hasCodeExecution = otherTools.some((tool) => tool.name === "execute_code");
  // execute_code always has code + console to show; debug mode makes every call inspectable
  const canExpand =
    tools.length > 1 || Boolean(singleErrorText) || hasCodeExecution || toolDebug;
  const effectiveOpen = canExpand && isOpen;
  const singleDebugTool =
    toolDebug && tools.length === 1 && tools[0].name !== "execute_code" ? tools[0] : null;

  const quizTools = otherTools.filter(
    (tool) => tool.name === "interactive_quiz" && Boolean(tool.input)
  );

  return (
    <>
      <div className="mb-3">
        {/* Borderless trigger matching ThinkingAccordion ("Thought for Xs") */}
        <button
          type="button"
          disabled={!canExpand}
          onClick={canExpand ? () => setIsOpen((v) => !v) : undefined}
          aria-expanded={canExpand ? effectiveOpen : undefined}
          className={cn(
            "group inline-flex items-center gap-2 -ml-1.5 px-1.5 py-1 rounded-[8px] text-[13.5px] font-medium select-none transition-colors",
            canExpand ? "cursor-pointer hover:bg-[var(--hover)]" : "cursor-default"
          )}
        >
          {isRunning ? (
            <Loader2 className="w-4 h-4 shrink-0 animate-spin text-[var(--muted)]" />
          ) : failedCount > 0 ? (
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400/90" />
          ) : (
            <ToolGlyph
              name={tools.length === 1 ? tools[0].name : undefined}
              tool={tools.length === 1 ? tools[0] : undefined}
              className="w-4 h-4 shrink-0 text-[var(--muted)]"
            />
          )}

          <span
            className={cn(
              "transition-colors truncate max-w-[260px] sm:max-w-[440px]",
              isRunning
                ? "text-shimmer"
                : failedCount > 0 && tools.length === 1
                  ? "text-red-400/90"
                  : cn("text-[var(--muted)]", canExpand && "group-hover:text-[var(--ink)]")
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

          {totalDuration > 0 ? (
            <span className="font-mono text-[11.5px] text-[var(--muted)] shrink-0">
              ({totalDuration}s)
            </span>
          ) : null}

          {canExpand ? (
            <ChevronDown
              className={cn(
                "w-3.5 h-3.5 shrink-0 transition-transform duration-200",
                singleErrorText ? "text-red-400/70" : "text-[var(--muted)]",
                effectiveOpen && "rotate-180"
              )}
            />
          ) : null}
        </button>

        {/* Smooth grid-rows drawer — stays mounted when execute_code is present so WASM executes */}
        {canExpand ? (
          <div
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
              effectiveOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            )}
          >
            <div className="overflow-hidden">
              {singleDebugTool ? (
                <div className="mt-1.5 ml-[7px]">
                  <ToolDebugDetails tool={singleDebugTool} />
                </div>
              ) : singleErrorText ? (
                <pre className="mt-1.5 ml-[7px] max-w-[620px] whitespace-pre-wrap break-words rounded-[8px] border border-red-400/20 bg-red-400/5 px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed text-red-400/90">
                  {singleErrorText}
                </pre>
              ) : (
                <div className="mt-1.5 ml-[7px] pl-4 border-l border-[var(--border)] space-y-1">
                  {tools.length > 1 && searchTools.length > 0 ? (
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

                    return tools.length > 1 ? (
                      <ToolActivityRow key={tool.id} tool={tool} t={t} debug={toolDebug} />
                    ) : null;
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Standalone visuals (charts, generated images) — rendered OUTSIDE the tool block */}
      <ToolVisualGallery visuals={standaloneVisuals} />

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
    </>
  );
}

/** Borderless soft monochrome trace row for tools like read_file, write_file, vision_tool */
function ToolActivityRow({
  tool,
  t,
  debug = false,
}: {
  tool: ToolActivity;
  t: Translate;
  /** Admin tool debug mode: the row expands to show the call's input/output. */
  debug?: boolean;
}) {
  const isRunning = isRunningTool(tool);
  const isError = tool.state === "error";

  // Live timer: ticks while running, then locks to server-reported durationSec
  const [liveSec, setLiveSec] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const start = tool.startedAt ?? Date.now();
    const tick = () => setLiveSec(Math.max(1, Math.round((Date.now() - start) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isRunning, tool.startedAt]);

  const displaySec = isRunning
    ? liveSec
    : (tool.durationSec !== undefined && tool.durationSec > 0 ? tool.durationSec : undefined);

  const [showDetails, setShowDetails] = useState(false);
  const canExpand = debug;

  const rowContent = (
    <>
      {isRunning ? (
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-[var(--muted)]" />
      ) : isError ? (
        <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-400/90" />
      ) : (
        <ToolGlyph name={tool.name} tool={tool} className="w-3.5 h-3.5 shrink-0 text-[var(--muted)]" />
      )}
      <span className={cn("truncate", isError ? "text-red-400/90" : "text-[var(--muted)]")}>
        {describeTool(tool, t)}
      </span>
      {(() => {
        const stats = extractDiffStats(tool);
        return stats ? <DiffBadge stats={stats} /> : null;
      })()}
      {displaySec !== undefined ? (
        <span className="font-mono text-[11px] text-[var(--muted)]/80 shrink-0">({displaySec}s)</span>
      ) : null}
      {canExpand ? (
        <ChevronDown
          className={cn(
            "w-3 h-3 shrink-0 transition-transform duration-200",
            isError ? "text-red-400/70" : "text-[var(--muted)]",
            showDetails && "rotate-180"
          )}
        />
      ) : null}
    </>
  );

  if (!canExpand) {
    return <div className="flex items-center gap-2 py-1 text-[13px] select-none">{rowContent}</div>;
  }

  return (
    <div className="py-1">
      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        aria-expanded={showDetails}
        className="flex items-center gap-2 text-[13px] select-none cursor-pointer rounded-[6px] -ml-1 px-1 hover:bg-[var(--hover)] transition-colors"
      >
        {rowContent}
      </button>
      {showDetails ? (
        debug ? (
          <div className="mt-1 ml-5">
            <ToolDebugDetails tool={tool} />
          </div>
        ) : (
          <pre className="mt-1 ml-5 max-w-[620px] whitespace-pre-wrap break-words rounded-[8px] border border-red-400/20 bg-red-400/5 px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed text-red-400/90">
            {tool.error}
          </pre>
        )
      ) : null}
    </div>
  );
}

/** Large outputs (fetched pages, file contents) are cut so the chat stays responsive. */
const DEBUG_JSON_MAX_CHARS = 20_000;

function formatDebugJson(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > DEBUG_JSON_MAX_CHARS
    ? `${text.slice(0, DEBUG_JSON_MAX_CHARS)}\n… (${text.length - DEBUG_JSON_MAX_CHARS} more chars)`
    : text;
}

/** Wraps text in a Markdown code fence longer than any backtick run inside it. */
function fenced(text: string, language: string): string {
  const longestRun = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function fileNamesOf(data: Record<string, unknown>): string[] {
  return Array.isArray(data.generatedFiles)
    ? (data.generatedFiles as unknown[])
        .map((f) => String(asRecord(f).displayName || asRecord(f).filename || ""))
        .filter(Boolean)
    : [];
}

/** Window header / code / output / footer of a command-like tool call, styled as a terminal. */
function TerminalDebugView({
  tool,
  shell,
  subtitle,
  code,
  codeLanguage,
  stdout,
  stderr,
  exitCode,
  durationMs,
  timedOut,
  footer,
  footerRight,
}: {
  tool: ToolActivity;
  shell: string;
  subtitle?: string;
  code: string;
  codeLanguage: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number | null;
  timedOut: boolean;
  footer?: string[];
  footerRight?: string;
}) {
  const errorText = stderr || tool.error || "";
  const hasOutput = Boolean(stdout || errorText);
  const failed = tool.state === "error" || timedOut || (exitCode !== null && exitCode !== 0);
  const footerItems = (footer ?? []).filter(Boolean);

  return (
    <div className="max-w-[620px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--panel-elevated)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-1.5 font-mono text-[11px] text-[var(--muted)]">
        <Terminal className="h-3 w-3 shrink-0" />
        <span className="shrink-0">{shell}</span>
        {subtitle ? <span className="truncate font-sans">· {subtitle}</span> : null}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {isRunningTool(tool) ? <span>running…</span> : null}
          {timedOut ? <span className="text-amber-400">timeout</span> : null}
          {exitCode !== null ? (
            <span className={failed ? "text-red-400/90" : "text-emerald-400"}>exit {exitCode}</span>
          ) : null}
          {durationMs !== null ? <span>{(durationMs / 1000).toFixed(1)}s</span> : null}
        </span>
      </div>

      {code ? (
        <MarkdownRenderer
          content={fenced(code, codeLanguage)}
          className="px-1 [&_.group]:!my-1 [&_pre]:!max-h-[260px] [&_pre]:!overflow-y-auto"
        />
      ) : null}

      {hasOutput ? (
        <div className="border-t border-[var(--border)] px-3 py-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Output</div>
          <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed">
            {stdout ? <span className="text-[var(--ink)]">{stdout}</span> : null}
            {stdout && errorText ? "\n" : null}
            {errorText ? <span className="text-red-400/90">{errorText}</span> : null}
          </pre>
        </div>
      ) : null}

      {footerItems.length > 0 || footerRight ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border)] px-3 py-1.5 font-mono text-[11px] text-[var(--muted)]">
          {footerItems.map((item) => (
            <span key={item} className="truncate">
              {item}
            </span>
          ))}
          {footerRight ? <span className="ml-auto shrink-0">{footerRight}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** `exec_command`: the bash command, then its output. */
function ExecCommandDebugView({ tool }: { tool: ToolActivity }) {
  const input = asRecord(tool.input);
  const outer = asRecord(tool.output);
  const data = asRecord(outer.data ?? outer);
  const files = fileNamesOf(data);
  const workspace = asRecord(data.workspace);
  const usedMb = typeof workspace.usedBytes === "number" ? workspace.usedBytes / 1048576 : null;
  const quotaMb = typeof workspace.quotaBytes === "number" ? workspace.quotaBytes / 1048576 : null;

  return (
    <TerminalDebugView
      tool={tool}
      shell="bash"
      subtitle={asText(input.description).trim() || undefined}
      code={asText(input.command)}
      codeLanguage="bash"
      stdout={asText(data.stdout)}
      stderr={asText(data.stderr)}
      exitCode={typeof data.exitCode === "number" ? data.exitCode : null}
      durationMs={typeof data.durationMs === "number" ? data.durationMs : null}
      timedOut={data.timedOut === true}
      footer={files.length > 0 ? [`files: ${files.join(", ")}`] : undefined}
      footerRight={usedMb !== null && quotaMb !== null ? `disk ${usedMb.toFixed(1)} / ${quotaMb.toFixed(0)} MB` : undefined}
    />
  );
}

/** `run_skill_script`: the inline script (or helper command line), then its output. */
function SkillScriptDebugView({ tool }: { tool: ToolActivity }) {
  const input = asRecord(tool.input);
  const outer = asRecord(tool.output);
  const data = asRecord(outer.data ?? outer);
  const code = asText(input.code);
  const script = asText(input.script) || asText(data.script);
  const runtime =
    asText(data.runtime) ||
    asText(input.runtime) ||
    (/\.(?:c|m)?js$/i.test(script) || /\brequire\s*\(/.test(code) ? "node" : "python");
  const args = Array.isArray(input.args) ? (input.args as unknown[]).map(String) : [];
  const skill = asText(input.skill);
  const commandLine = code
    ? code
    : [runtime === "node" ? "node" : "python3", script ? `scripts/${script}` : "", ...args].filter(Boolean).join(" ");
  const inputFiles = Object.keys(asRecord(input.inputFiles));
  const files = fileNamesOf(data);
  const jsonOutputs = Object.keys(asRecord(data.jsonOutputs));

  return (
    <TerminalDebugView
      tool={tool}
      shell={runtime === "node" ? "node" : "python"}
      subtitle={[skill && `skill ${skill}`, script && !code ? script : ""].filter(Boolean).join(" · ") || undefined}
      code={commandLine}
      codeLanguage={code ? (runtime === "node" ? "javascript" : "python") : "bash"}
      stdout={asText(data.stdout)}
      stderr={asText(data.stderr)}
      exitCode={typeof data.exitCode === "number" ? data.exitCode : null}
      durationMs={typeof data.durationMs === "number" ? data.durationMs : null}
      timedOut={data.timedOut === true}
      footer={[
        inputFiles.length > 0 ? `input: ${inputFiles.join(", ")}` : "",
        files.length > 0 ? `files: ${files.join(", ")}` : "",
        jsonOutputs.length > 0 ? `json: ${jsonOutputs.join(", ")}` : "",
      ]}
    />
  );
}

/** Fields whose string value is source code / document text, with the fence language to show it in. */
const CODE_FIELD_LANGUAGE: Record<string, string> = {
  code: "",
  command: "bash",
  content: "",
  html: "html",
  markdown: "markdown",
  css: "css",
  sql: "sql",
  old_string: "",
  new_string: "",
};

function languageForFile(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    py: "python", js: "javascript", cjs: "javascript", mjs: "javascript", ts: "typescript", tsx: "tsx",
    jsx: "jsx", html: "html", htm: "html", css: "css", json: "json", md: "markdown", sh: "bash",
    sql: "sql", yml: "yaml", yaml: "yaml", xml: "xml", csv: "csv", svg: "xml",
  };
  return map[ext] ?? "";
}

/** One field of a tool's input or output, shown by type instead of as one JSON blob. */
function DebugField({
  name,
  value,
  fileHint,
  languageHint,
}: {
  name: string;
  value: unknown;
  fileHint: string;
  languageHint: string;
}) {
  const label = (
    <div className="mb-0.5 font-mono text-[11px] text-[var(--muted)]">{name}</div>
  );

  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
    return (
      <div className="flex items-baseline gap-2 font-mono text-[11.5px]">
        <span className="text-[var(--muted)] shrink-0">{name}</span>
        <span className={typeof value === "boolean" ? (value ? "text-emerald-400" : "text-red-400/90") : "text-[var(--ink)]"}>
          {String(value)}
        </span>
      </div>
    );
  }

  if (typeof value === "string") {
    const isCode = name in CODE_FIELD_LANGUAGE;
    if (!isCode && !value.includes("\n") && value.length <= 160) {
      return (
        <div className="flex items-baseline gap-2 font-mono text-[11.5px] min-w-0">
          <span className="text-[var(--muted)] shrink-0">{name}</span>
          <span className="text-[var(--ink)] break-all">{value}</span>
        </div>
      );
    }
    const language = CODE_FIELD_LANGUAGE[name] || (name === "code" ? languageHint : "") || languageForFile(fileHint);
    const text = value.length > DEBUG_JSON_MAX_CHARS
      ? `${value.slice(0, DEBUG_JSON_MAX_CHARS)}\n… (${value.length - DEBUG_JSON_MAX_CHARS} more chars)`
      : value;
    return (
      <div>
        {label}
        {isCode ? (
          <MarkdownRenderer
            content={fenced(text, language)}
            className="[&_.group]:!my-0 [&_pre]:!max-h-[260px] [&_pre]:!overflow-y-auto"
          />
        ) : (
          <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-[var(--border)] bg-[var(--panel-elevated)] px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed text-[var(--ink)]">
            {text}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div>
      {label}
      <MarkdownRenderer
        content={fenced(formatDebugJson(value), "json")}
        className="[&_.group]:!my-0 [&_pre]:!max-h-[240px] [&_pre]:!overflow-y-auto"
      />
    </div>
  );
}

function DebugFieldGroup({
  title,
  value,
  fileHint,
  languageHint,
}: {
  title: string;
  value: unknown;
  fileHint: string;
  languageHint: string;
}) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? asRecord(value) : null;
  const entries = record ? Object.entries(record) : [];
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{title}</div>
      {record ? (
        entries.length > 0 ? (
          entries.map(([key, v]) => (
            <DebugField key={key} name={key} value={v} fileHint={fileHint} languageHint={languageHint} />
          ))
        ) : (
          <div className="font-mono text-[11.5px] text-[var(--muted)]">—</div>
        )
      ) : (
        <DebugField name="value" value={value} fileHint={fileHint} languageHint={languageHint} />
      )}
    </div>
  );
}

/** Admin tool debug inspect of one tool call: terminal for commands, typed fields for the rest. */
function ToolDebugDetails({ tool }: { tool: ToolActivity }) {
  if (tool.name === "exec_command") return <ExecCommandDebugView tool={tool} />;
  if (tool.name === "run_skill_script") return <SkillScriptDebugView tool={tool} />;

  const input = asRecord(tool.input);
  const outer = asRecord(tool.output);
  // `{ success, data }` envelopes: the data is what matters
  const output = tool.output !== undefined && "data" in outer && Object.keys(outer).length <= 3 ? outer.data : tool.output;
  const fileHint = asText(input.filename) || asText(input.path) || asText(asRecord(output).filename);
  const languageHint = asText(input.language);

  return (
    <div className="max-w-[620px] space-y-3 rounded-[10px] border border-[var(--border)] bg-[var(--panel)] p-3">
      <div className="font-mono text-[11px] text-[var(--muted)]/80 select-all">
        {tool.name} · {tool.id} · {tool.state}
      </div>
      {tool.error ? (
        <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-red-400/20 bg-red-400/5 px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed text-red-400/90">
          {tool.error}
        </pre>
      ) : null}
      <DebugFieldGroup title="Input" value={tool.input ?? null} fileHint={fileHint} languageHint={languageHint} />
      {tool.output !== undefined ? (
        <DebugFieldGroup title="Output" value={output} fileHint={fileHint} languageHint={languageHint} />
      ) : null}
    </div>
  );
}
