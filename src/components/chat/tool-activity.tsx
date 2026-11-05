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
import { cn } from "@/lib/cn";
import { useAccount } from "@/providers/account-provider";
import { useI18n } from "@/providers/i18n-provider";
import type { InteractiveQuizInput } from "@/lib/tools/interactive-quiz";
import { getFaviconUrl } from "@/lib/tools/compact-source";
import type { ToolActivity } from "@/types";
import { CodeExecutionWidget, type StandaloneChartFigure } from "./code-execution-widget";
import { InteractiveQuizWidget } from "./interactive-quiz-widget";
import { SearchActivityAccordion, SourceFavicon } from "./search-activity-accordion";
import { ToolDebugDetails } from "./tool-debug-details";
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

export const isSearchTool = (tool: ToolActivity) =>
  tool.name === "web_search" || tool.name === "deep_search";

const FETCH_TITLE_MAX = 48;

/** The page a `fetch_url` call is opening: its title once known, otherwise the URL itself. */
function fetchTarget(tool: ToolActivity): { label: string; favicon: string } {
  const input = (tool.input && typeof tool.input === "object" ? tool.input : {}) as Record<string, unknown>;
  const output = (tool.output && typeof tool.output === "object" ? tool.output : {}) as Record<string, unknown>;
  const video = (output.video && typeof output.video === "object" ? output.video : {}) as Record<string, unknown>;
  const url = typeof output.finalUrl === "string" ? output.finalUrl : typeof input.url === "string" ? input.url : "";
  const title = (typeof video.title === "string" && video.title) || (typeof output.title === "string" && output.title) || "";
  const full = title || url;
  return {
    label: full.length > FETCH_TITLE_MAX ? `${full.slice(0, FETCH_TITLE_MAX - 1)}…` : full,
    favicon: getFaviconUrl(url),
  };
}
export const isRunningTool = (tool: ToolActivity) =>
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
export function describeTool(tool: ToolActivity, t: Translate): string {
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
      return t("message.toolFetchUrl", { target: fetchTarget(tool).label || "url" });
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

export function ToolGlyph({
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

          {tools.length === 1 && tools[0].name === "fetch_url" ? (
            <FetchUrlLabel tool={tools[0]} running={isRunning} failed={failedCount > 0} canExpand={canExpand} />
          ) : (
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
          )}

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

/** "Opening [favicon] Page title" for `fetch_url`: the URL while it runs, the page title once read. */
function FetchUrlLabel({
  tool,
  running,
  failed,
  canExpand,
}: {
  tool: ToolActivity;
  running: boolean;
  failed: boolean;
  canExpand: boolean;
}) {
  const { t } = useI18n();
  const { label, favicon } = fetchTarget(tool);
  const tone = running
    ? "text-shimmer"
    : failed
      ? "text-red-400/90"
      : cn("text-[var(--muted)]", canExpand && "group-hover:text-[var(--ink)]");
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 max-w-[260px] sm:max-w-[440px]">
      <span className={cn("shrink-0 transition-colors", tone)}>{t("message.toolFetchUrlOpening")}</span>
      <span
        className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-[var(--border)] bg-white/[0.03] py-0.5 pl-1 pr-2"
        title={label}
      >
        <SourceFavicon src={favicon} className="h-3.5 w-3.5" />
        <span className={cn("truncate text-[12.5px] transition-colors", tone)}>{label || "url"}</span>
      </span>
    </span>
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
      {tool.name === "fetch_url" ? (
        <FetchUrlLabel tool={tool} running={isRunning} failed={isError} canExpand={canExpand} />
      ) : (
        <span className={cn("truncate", isError ? "text-red-400/90" : "text-[var(--muted)]")}>
          {describeTool(tool, t)}
        </span>
      )}
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

