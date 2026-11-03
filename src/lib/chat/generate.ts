import { db } from "@/lib/db";
import { Prisma } from "@/generated/client";
import { ApiError } from "@/lib/api/response";
import { GatewayError, isUpstreamRateLimitText } from "@/lib/routing/errors";
import { getRoutingSettings } from "@/lib/routing/settings";
import { executeWithFallback } from "@/lib/routing/executor";
import { devnubyTools, executeTool, type ToolExecutionResult } from "@/lib/tools";
import { sanitizeToolOutputForStorage } from "@/lib/tools/compact-source";
import { buildSkillsSystemPromptBlock } from "@/lib/skills/runtime";
import { recordPartialUsage, recordUserUsage, type RecordUsageInput } from "@/lib/chat/quota";
import { assertUserModelAccess } from "@/lib/chat/model-access";
import { registerStream, unregisterStream } from "@/lib/chat/active-streams";
import { startStreamHub } from "@/lib/chat/stream-hub";
import { getChatSettings } from "@/lib/chat/settings";
import { recordToolExecutionLog } from "@/lib/chat/tool-log";
import { buildFallbackAnswer, hasSuccessfulToolResult, listProducedFiles } from "@/lib/chat/turn-recovery";
import {
  saveTurnDraftToRedis,
  saveSessionMemoryToRedis,
  flushTurnToDatabase,
} from "@/lib/chat/redis-chat-state";
import { DEFAULT_TIME_ZONE } from "@/lib/chat/timezone";
import { buildSystemPrompt } from "@/lib/chat/system-prompts";
import { formatFileSize } from "@/lib/files/policy";
import { buildProjectContextPrompt, loadSessionProject } from "@/lib/projects/source-context";
import type {
  ChatMessageInput,
  ReasoningEffortVariant,
  ToolCallInput,
} from "@/lib/gateways/types";
import {
  createUIMessageStream,
  type UIMessageChunk,
} from "ai";

export interface StreamGenerationOptions {
  userId: bigint;
  userPublicId: string;
  sessionId: bigint;
  sessionPublicId: string;
  assistantMessageId: bigint;
  assistantMessagePublicId: string;
  userMessagePublicId: string;
  requestedModelPublicId?: string;
  sessionModelPublicId?: string | null;
  reasoningEffort?: ReasoningEffortVariant;
  forceWebSearch?: boolean;
  conversationHistory: ChatMessageInput[];
  /** Project sources the user @mentioned in the current message (ProjectFile publicIds) */
  mentionedSourceIds?: string[];
  /** Validated IANA zone of the user (see `resolveClientTimeZone`) */
  clientTimeZone?: string;
  requestId: string;
  /** Runs once the generation ends in any way (e.g. frees its concurrency slot) */
  onSettled?: (() => Promise<void>) | null;
}

/**
 * System prompt carrying the real current date/time from the server clock, rendered in
 * the user's own time zone (from the `x-client-tz` header) alongside UTC.
 */
function buildCurrentDatePrompt(timeZone: string, now = new Date()): string {
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  }).format(now);
  const year = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(now);

  return [
    `Current date and time for the user: ${local} (time zone ${timeZone}). UTC: ${now.toISOString()}.`,
    `The current year is ${year}. This is a verified fact from the server clock and overrides anything you assume from your training data.`,
    "Your training data ends before this date, so events, releases, and benchmarks dated up to the current date are real, not projections or fiction.",
    "Never claim it is still an earlier year. When the user says \"now\", \"today\", or \"this year\", use the date above, including in web search queries.",
  ].join(" ");
}

interface AccumulatedToolCall {
  callId: string;
  effectiveCallId: string;
  name: string;
  args: string;
  startedAt: number;
  hasEmittedStart: boolean;
  pendingDelta: string;
  lastDeltaFlushAt: number;
}

/**
 * Resolves the catalog model to use for generation:
 * 1. Explicitly requested model (validated active)
 * 2. Session's bound model (if active)
 * 3. Default model from admin-managed `app_settings` (validated active)
 * Returns the resolved publicId, DB internal id, and whether tools are supported.
 */
const resolvedModelSelect = {
  id: true,
  publicId: true,
  displayName: true,
  description: true,
  contextWindow: true,
  supportsTools: true,
  supportsVision: true,
  supportsReasoning: true,
  inputPricePerMillion: true,
  outputPricePerMillion: true,
  provider: { select: { name: true } },
} as const;

type ResolvedModelType = Prisma.CatalogModelGetPayload<{ select: typeof resolvedModelSelect }>;
const resolvedModelCache = new Map<string, { model: ResolvedModelType; expiresAt: number }>();

export function invalidateResolvedModelCache(): void {
  resolvedModelCache.clear();
}

export async function resolveCatalogModel(
  requested?: string,
  sessionFallback?: string | null
) {
  const candidatePublicId =
    requested?.trim() ||
    sessionFallback?.trim() ||
    (await getRoutingSettings()).defaultModel;

  const now = Date.now();
  const cached = resolvedModelCache.get(candidatePublicId);
  if (cached && now < cached.expiresAt) {
    return cached.model;
  }

  let model = await db.catalogModel.findFirst({
    where: { publicId: candidatePublicId, status: "active" },
    select: resolvedModelSelect,
  });

  if (!model && candidatePublicId !== (await getRoutingSettings()).defaultModel) {
    const defaultPublicId = (await getRoutingSettings()).defaultModel;
    model = await db.catalogModel.findFirst({
      where: { publicId: defaultPublicId, status: "active" },
      select: resolvedModelSelect,
    });
  }

  if (!model) {
    throw ApiError.modelUnavailable("No active AI model is currently available.");
  }

  // Only cache real catalog ids: caching fallbacks under arbitrary client strings grows unbounded
  if (model.publicId === candidatePublicId) {
    resolvedModelCache.set(candidatePublicId, { model, expiresAt: now + 30_000 });
  }

  return model;
}

/**
 * Slices a large burst text chunk into word-aligned sub-chunks so even bursty upstream
 * gateways render smoothly without blocking the SSE event loop or trapping trailing words.
 */
function sliceBurstText(text: string): string[] {
  if (text.length <= 20) return [text];
  const tokens = text.match(/\S+\s*|\s+/g) ?? [text];
  if (tokens.length <= 2) return [text];

  const slices: string[] = [];
  let current = "";
  for (const tok of tokens) {
    current += tok;
    if (current.length >= 14) {
      slices.push(current);
      current = "";
    }
  }
  if (current) slices.push(current);
  return slices;
}

/**
 * Core AI SDK UI message stream generator. Runs the multi-turn tool loop against the
 * DB-driven smart routing executor (executeWithFallback), translates gateway events
 * to AI SDK UIMessageChunks with word smoothing, executes tools, persists final
 * state to DB, and tracks usage.
 */
export function createChatGenerationStream(
  options: StreamGenerationOptions
): ReadableStream<UIMessageChunk> {
  const {
    userId,
    userPublicId,
    sessionId,
    sessionPublicId,
    assistantMessageId,
    assistantMessagePublicId,
    userMessagePublicId,
    requestedModelPublicId,
    sessionModelPublicId,
    reasoningEffort,
    forceWebSearch,
    conversationHistory,
    mentionedSourceIds,
    clientTimeZone,
    requestId,
    onSettled,
  } = options;

  // Only an explicit /stop aborts: a dropped client connection (reload) must not
  // kill the generation, which keeps running in the stream hub for resumption.
  const streamController = registerStream(assistantMessagePublicId);
  const combinedSignal = streamController.signal;

  const source = createUIMessageStream({
    execute: async ({ writer }) => {
      let fullContent = "";
      let fullReasoning = "";
      let promptTokens = 0;
      let completionTokens = 0;
      // Collect executed tool call parts to persist to DB so widgets & tool outputs survive page reloads
      // (also on failure, so files already created don't vanish with the failed reply)
      const executedToolParts: Record<string, unknown>[] = [];
      // Set once the model is resolved, so aborted/failed streams can still be billed
      let billedModel: RecordUsageInput["model"] | null = null;
      let estimatePromptChars = () => 0;

      const cleanup = () => {
        unregisterStream(assistantMessagePublicId, streamController);
      };

      try {
        const resolvedModel = await resolveCatalogModel(
          requestedModelPublicId,
          sessionModelPublicId
        );

        // Verify model access permissions for this user
        await assertUserModelAccess(userId, resolvedModel.id);

        // Bind the resolved catalog model to the assistant message record
        await db.chatMessage.update({
          where: { id: assistantMessageId },
          data: { catalogModelId: resolvedModel.id },
        });

        // 1. Emit start chunk with assistant messageId and meta
        writer.write({
          type: "start",
          messageId: assistantMessagePublicId,
          messageMetadata: {
            messageId: assistantMessagePublicId,
            userMessageId: userMessagePublicId,
            model: resolvedModel.publicId,
            requestId,
          },
        });

        // Collect executed tool call parts to persist to DB so widgets & tool outputs survive page reloads
        const currentMessages: ChatMessageInput[] = [...conversationHistory];
        billedModel = resolvedModel;
        // Text only: base64 image parts would inflate the estimate by megabytes
        estimatePromptChars = () =>
          currentMessages.reduce(
            (n, m) =>
              n +
              (typeof m.content === "string"
                ? m.content.length
                : m.content.reduce((k, p) => k + (p.type === "text" ? p.text.length : 0), 0)),
            0
          );

        // Parallelize initial DB lookups (sessionFiles, user, chatSettings) to minimize TTFT
        const [sessionFiles, user, chatSettings, sessionProject] = await Promise.all([
          resolvedModel.supportsTools
            ? db.sessionFile.findMany({
                where: { sessionId },
                select: {
                  publicId: true,
                  filename: true,
                  mimeType: true,
                  sizeBytes: true,
                },
                orderBy: { createdAt: "asc" },
              })
            : Promise.resolve([]),
          db.user.findUnique({ where: { id: userId }, select: { name: true } }),
          resolvedModel.supportsTools
            ? getChatSettings()
            : Promise.resolve({ maxToolRounds: 0, toolDebug: false }),
          loadSessionProject(sessionId),
        ]);

        // Project chats: custom instructions + shared sources sit right before the conversation
        if (sessionProject) {
          const projectPrompt = await buildProjectContextPrompt({
            project: sessionProject,
            mentionedSourceIds,
            contextWindow: resolvedModel.contextWindow,
            supportsTools: resolvedModel.supportsTools,
          });
          if (projectPrompt) {
            currentMessages.unshift({ role: "system", content: projectPrompt });
          }
        }

        // `read_project_source` only makes sense inside a project that has sources
        const availableTools = sessionProject?.files.length
          ? devnubyTools
          : devnubyTools.filter((t) => t.name !== "read_project_source");

        // If tools are supported, inject comprehensive tool guidelines and active session files
        if (resolvedModel.supportsTools) {
          currentMessages.unshift({
            role: "system",
            content: [
              "# Tools & Operating Protocol",
              "",
              "## 1. Document Reading (`read_file`)",
              "- You have persistent access to files in this chat session via `read_file`. ALWAYS use `read_file` when the user asks about an uploaded document, previous file, page count, or specific facts.",
              "- NEVER guess document contents, NEVER use `web_search` to substitute user documents, and NEVER use `execute_code` (Python) to read or parse files (the code sandbox cannot access storage files).",
              "- Document structure markers:",
              "  * PDF files: marked per page with `=== [PAGE X] ===`. Use these exact page numbers when referencing pages.",
              "  * Excel/OpenDocument spreadsheets (.xlsx, .xls, .ods): marked per sheet with `=== [SHEET: SheetName] ===`.",
              "  * PowerPoint (.pptx): marked per slide with `=== [SLIDE X] ===`; speaker notes follow as `[Notes]`.",
              "  * EPUB eBooks: marked per chapter with `=== [CHAPTER X: Title] ===`.",
              "  * Word DOCX: Markdown headings, lists, and `| a | b |` tables; `[Header]`, `[Footer]` and `[Footnotes]` sections. Page markers `=== [PAGE X] ===` come from the page breaks Word recorded when the file was last saved, so they match Word's layout closely but may drift slightly in other viewers. If a DOCX has no page markers, the file has no stored pagination: say the page number cannot be determined exactly.",
              "  * OpenDocument ODT: preserved with Markdown headings, lists, and tables.",
              "  * Legacy Word DOC and RTF: plain paragraphs, tables as `| a | b |` rows (no headings).",
              "- Pagination: `read_file` returns up to 100 lines per call. If `hasMore: true`, continue reading with `nextStartLine` as needed.",
              "",
              "## 2. Canvas Artifacts (`write_file`) & Web/Landing Pages",
              "- MANDATORY FILE CREATION RULE: If the user asks to create, build, generate, or code any file, website, web page (HTML/CSS/JS), landing page, app, component, markdown document, SVG, script, or program:",
              "  * YOU MUST IMMEDIATELY CALL THE `write_file` TOOL in your very first response!",
              "  * DO NOT stop after writing an intro message or saying 'Mari kita simpan dan buat file' without invoking `write_file` in the exact same turn!",
              "  * Place the entire, functional, high-quality code in the `content` argument of `write_file`.",
              "  * You may include a brief 1-2 sentence introduction before the tool call, but the tool call `write_file` MUST be executed in that response.",
              "- Saved files appear in the user's right-hand canvas panel for live interactive preview and download.",
              "",
              "## 3. WebAssembly Sandbox (`execute_code`)",
              "- Browser-isolated runtime for Python (numpy, pandas, matplotlib) and JavaScript. Use ONLY for pure computation, data calculations, and mathematical plotting (`matplotlib.pyplot`).",
              "- Sandbox runs in the BROWSER (WASM). It has NO internet, NO network access, and critically NO access to session files (R2 storage). You CANNOT read or write uploaded documents, spreadsheets, or images from here.",
              "- If the user asks to create, edit, or analyze a DOCX/XLSX/PPTX/PDF file they uploaded: DO NOT use `execute_code`. Use `create_document`, `create_spreadsheet`, `create_presentation`, or `read_file` instead.",
              "",
              "## 4. Web Search Citations (`web_search` / `deep_search`)",
              "- When citing search results, ALWAYS format sources as inline Markdown links `[Domain or Title](exact_url)` immediately next to each referenced claim or fact.",
              "",
              "## 5. Calculation (`calculate`)",
              "- For any arithmetic, percentages, ratios, statistics, or unit conversions, ALWAYS use `calculate` instead of mental math to guarantee exact results.",
              "",
              "## 6. Fetching URLs (`fetch_url`)",
              "- When the user provides a URL or asks to read a specific web page/documentation, use `fetch_url`. Do NOT guess page contents.",
              "",
              "## 7. Persistent Memory (`memory_note`)",
              "- Use `memory_note` with action 'save' to remember user preferences/facts that should persist across sessions; 'list' to recall them; 'delete' to remove. Only store facts the user explicitly wants retained.",
              "",
              "## 8. Surgical File Editing (`edit_file`) & Creation (`write_file`)",
              "- When modifying an existing text or code file (.html, .css, .js, .ts, .md, .csv, .json, .py, etc.), PREFER calling `edit_file` with `targetText` (or `startLine`/`endLine`) and `replacementText`. This performs a precise, surgical diff edit on the exact same file without rewriting the whole document.",
              "- Use `write_file` when creating a brand-new file from scratch or when completely rewriting an entire document.",
              "- When editing, `edit_file` updates the exact same file in session storage and returns a unified diff.",
              "- If the user asks to revert or undo a change, you can call `edit_file` to invert the diff or restore the previous text snippet.",
              "- Do NOT edit raw binary files with `edit_file`.",
              "",
              "## 9. Creating Binary Documents & Spreadsheets (`create_document`, `create_spreadsheet`, `create_presentation`)",
              "- When the user asks to create, export, or generate Microsoft Office documents:",
              "  * Word Document (.docx) for CVs, resumes, cover letters, formal proposals, memos, contracts, and reports: ALWAYS use `create_document` with structured sections (headings, styled paragraphs, bullet lists, numbered lists, and tables).",
              "  * Excel Spreadsheet (.xlsx) for budgets, financial plans, schedules, matrices, or data tables: ALWAYS use `create_spreadsheet` with sheet names, structured headers, cell data, and Excel formulas (e.g. { formula: '=SUM(B2:B10)' }).",
              "  * PowerPoint Presentation (.pptx) for pitch decks, slides, quarterly reviews, and presentations: ALWAYS use `create_presentation` with structured slides, bullet points, and speaker notes.",
              "  * NEVER write fake mock binary strings into `write_file`. Always use these dedicated binary document tools so real, valid Office files are generated and immediately previewable/downloadable."
            ].join("\n"),
          });

          const skillsBlock = await buildSkillsSystemPromptBlock();
          if (skillsBlock) {
            currentMessages.unshift({ role: "system", content: skillsBlock });
          }

          if (sessionFiles.length > 0) {
            const fileLines = sessionFiles.map((f) => {
              const cleanName = f.filename.replace(/^\d+-[a-f0-9]+-/, "");
              const sizeLabel = formatFileSize(Number(f.sizeBytes));
              return `- Name: ${cleanName} | ID: ${f.publicId} | Size: ${sizeLabel} | Type: ${f.mimeType}`;
            });

            currentMessages.unshift({
              role: "system",
              content: `[Active Session Files]:\n${fileLines.join("\n")}\nTo read or inspect any of these files, call \`read_file\` passing either the file Name or ID.`,
            });
          }
        }

        // Models only know their training cutoff; ground every request in the real server clock
        currentMessages.unshift({
          role: "system",
          content: buildCurrentDatePrompt(clientTimeZone ?? DEFAULT_TIME_ZONE),
        });

        // Admin-managed prompts (identity, active model, ...) go first, placeholders filled
        const adminPrompt = await buildSystemPrompt({
          model: {
            publicId: resolvedModel.publicId,
            displayName: resolvedModel.displayName,
            providerName: resolvedModel.provider.name,
            description: resolvedModel.description,
            contextWindow: resolvedModel.contextWindow,
            supportsVision: resolvedModel.supportsVision,
            supportsTools: resolvedModel.supportsTools,
            supportsReasoning: resolvedModel.supportsReasoning,
          },
          userName: user?.name ?? "",
        });
        if (adminPrompt) {
          currentMessages.unshift({ role: "system", content: adminPrompt });
        }

        // Round budget is admin-managed (app_settings `chat.max_tool_rounds`),
        // with a strict 10-round emergency grace period before hard tool cutoff.
        const MAX_GRACE_TOOL_ROUNDS = 10;
        let remainingToolRounds = chatSettings.maxToolRounds;
        let remainingGraceRounds = MAX_GRACE_TOOL_ROUNDS;
        let stepIndex = 0;
        let reasoningStartTime: number | null = null;
        let reasoningDurationSec: number | null = null;
        // Set once the model must answer in prose from what it already gathered
        let forceFinalAnswer = false;
        // Track if we've pushed reasoning for the current step
        let hasPushedReasoningForStep = false;
        // Whether the last model pass wrote any prose, and whether it was cut off by an error
        let lastTurnHadText = false;
        let interruptedAfterTools = false;

        while (true) {
          if (combinedSignal.aborted) {
            throw new Error("CLIENT_ABORTED");
          }

          // Force web_search on first turn if user activated web search toggle
          // Tools stay declared on the final pass (history holds tool turns) but can't be called
          const toolChoice = forceFinalAnswer
            ? ("none" as const)
            : stepIndex === 0 && forceWebSearch && resolvedModel.supportsTools
              ? ({ type: "function" as const, function: { name: "web_search" } })
              : undefined;

          const gatewayStream = executeWithFallback({
            publicModelId: resolvedModel.publicId,
            requestId,
            userId,
            messageId: assistantMessageId,
            request: {
              messages: currentMessages,
              reasoningEffort,
              tools: resolvedModel.supportsTools ? availableTools : undefined,
              toolChoice,
              signal: combinedSignal,
            },
          });

          const toolCallsByIndex = new Map<number | string, AccumulatedToolCall>();
          let lastToolCallKey: number | string | null = null;
          let turnContent = "";
          let turnReasoning = "";
          let stepReasoningStartTime: number | null = null;
          let stepReasoningDurationSec: number | null = null;

          const textPartId = `text_${assistantMessagePublicId}_${stepIndex}`;
          const reasoningPartId = `reasoning_${assistantMessagePublicId}_${stepIndex}`;
          let hasEmittedTextStart = false;
          let hasEndedText = false;
          let hasEmittedReasoningStart = false;
          let hasEndedReasoning = false;

          const closeActiveReasoning = () => {
            if (hasEmittedReasoningStart && !hasEndedReasoning) {
              hasEndedReasoning = true;
              if (stepReasoningStartTime) {
                stepReasoningDurationSec = Math.max(
                  1,
                  Math.round((Date.now() - stepReasoningStartTime) / 1000)
                );
                reasoningDurationSec = (reasoningDurationSec ?? 0) + stepReasoningDurationSec;
              }
              writer.write({ type: "reasoning-end", id: reasoningPartId });
            }
          };

          const closeActiveText = () => {
            if (hasEmittedTextStart && !hasEndedText) {
              hasEndedText = true;
              writer.write({ type: "text-end", id: textPartId });
            }
          };

          let stepError: unknown = null;
          try {
          for await (const event of gatewayStream) {
            if (combinedSignal.aborted) {
              throw new Error("CLIENT_ABORTED");
            }

            if (event.type === "delta") {
              // Each tool step's prose is its own paragraph in the stored content
              if (!turnContent && fullContent.trim()) {
                fullContent += "\n\n";
              }
              turnContent += event.text;
              fullContent += event.text;

              if (isUpstreamRateLimitText(turnContent) || isUpstreamRateLimitText(fullContent)) {
                throw new GatewayError({
                  errorClass: "rate_limited",
                  httpStatus: 429,
                  message: "Anda sudah mencapai batas pada model ini. Silakan coba lagi nanti.",
                });
              }

              // Jawaban mulai keluar → fase berpikir selesai, tutup reasoning part sekarang
              closeActiveReasoning();

              if (!hasEmittedTextStart) {
                hasEmittedTextStart = true;
                writer.write({ type: "text-start", id: textPartId });
              }

              const slices = sliceBurstText(event.text);
              for (let i = 0; i < slices.length; i += 1) {
                writer.write({ type: "text-delta", id: textPartId, delta: slices[i] });
                if (slices.length > 1 && i < slices.length - 1 && i < 6) {
                  await new Promise((r) => setTimeout(r, 3));
                }
              }
            } else if (event.type === "reasoning") {
              if (reasoningStartTime === null) {
                reasoningStartTime = Date.now();
              }
              if (stepReasoningStartTime === null) {
                stepReasoningStartTime = Date.now();
              }
              turnReasoning += event.text;
              fullReasoning += event.text;
              if (!hasEmittedReasoningStart) {
                hasEmittedReasoningStart = true;
                writer.write({ type: "reasoning-start", id: reasoningPartId });
              }
              writer.write({
                type: "reasoning-delta",
                id: reasoningPartId,
                delta: event.text,
              });
            } else if (event.type === "tool_call") {
              // Immediately flush & close any active reasoning/text block BEFORE streaming tool call
              closeActiveReasoning();
              closeActiveText();

              const key: number | string =
                event.index !== undefined
                  ? event.index
                  : event.callId || lastToolCallKey || "call_0";
              lastToolCallKey = key;

              let existing = toolCallsByIndex.get(key);
              if (!existing) {
                const fallbackId = `call_${stepIndex}_${toolCallsByIndex.size}`;
                existing = {
                  callId: event.callId || "",
                  effectiveCallId: event.callId || fallbackId,
                  name: event.name || "",
                  args: "",
                  startedAt: Date.now(),
                  hasEmittedStart: false,
                  pendingDelta: "",
                  lastDeltaFlushAt: 0,
                };
                toolCallsByIndex.set(key, existing);
              } else {
                if (event.callId && !existing.callId) {
                  existing.callId = event.callId;
                  if (!existing.hasEmittedStart) {
                    existing.effectiveCallId = event.callId;
                  }
                }
                if (event.name && !existing.name) {
                  existing.name = event.name;
                }
              }

              // Emit tool-input-start immediately as soon as tool name is known
              if (existing.name && !existing.hasEmittedStart) {
                existing.hasEmittedStart = true;
                existing.startedAt = Date.now();
                writer.write({
                  type: "tool-input-start",
                  toolCallId: existing.effectiveCallId,
                  toolName: existing.name,
                  dynamic: true,
                  toolMetadata: {
                    startedAt: existing.startedAt,
                  },
                });
              }

              if (event.argumentsDelta) {
                existing.args += event.argumentsDelta;
                existing.pendingDelta += event.argumentsDelta;
              }

              // Stream tool-input-delta live so filename & line counts (+10, +50, +390) update in real time
              if (existing.hasEmittedStart && existing.pendingDelta.length > 0) {
                const now = Date.now();
                const isHeaderPhase = existing.args.length < 260;
                if (isHeaderPhase || now - existing.lastDeltaFlushAt >= 80) {
                  writer.write({
                    type: "tool-input-delta",
                    toolCallId: existing.effectiveCallId,
                    inputTextDelta: existing.pendingDelta,
                  });
                  existing.pendingDelta = "";
                  existing.lastDeltaFlushAt = now;
                }
              }
            } else if (event.type === "usage") {
              promptTokens += event.promptTokens;
              completionTokens += event.completionTokens;
            }
          }
          } catch (err) {
            // Once tools have produced results, a failing follow-up call (timeout, 4xx/5xx on
            // the grown context) must not throw away the finished work: wrap up with what we have.
            const isAbortErr =
              combinedSignal.aborted ||
              (err instanceof Error && err.message === "CLIENT_ABORTED") ||
              (err instanceof GatewayError && err.errorClass === "client_aborted");
            if (isAbortErr || stepIndex === 0 || !hasSuccessfulToolResult(executedToolParts)) throw err;
            console.warn(`[CHAT_STEP_RECOVERED] [${requestId}] step ${stepIndex}:`, err instanceof Error ? err.message : err);
            stepError = err;
          }

          closeActiveReasoning();
          closeActiveText();

          // Flush any remaining tool-input-delta chunks
          for (const tc of toolCallsByIndex.values()) {
            if (tc.hasEmittedStart && tc.pendingDelta.length > 0) {
              writer.write({
                type: "tool-input-delta",
                toolCallId: tc.effectiveCallId,
                inputTextDelta: tc.pendingDelta,
              });
              tc.pendingDelta = "";
            }
          }

          // Persist reasoning for this step if it happened (merge if consecutive with previous reasoning)
          if (!hasPushedReasoningForStep && turnReasoning.trim()) {
            const prevPart = executedToolParts[executedToolParts.length - 1];
            if (prevPart && prevPart.type === "reasoning") {
              prevPart.text = `${String(prevPart.text ?? "")}\n\n${turnReasoning}`;
              if (stepReasoningDurationSec !== null) {
                prevPart.durationSec =
                  (typeof prevPart.durationSec === "number" ? prevPart.durationSec : 0) +
                  stepReasoningDurationSec;
              }
            } else {
              executedToolParts.push({
                type: "reasoning",
                text: turnReasoning,
                state: "done",
                durationSec: stepReasoningDurationSec ?? undefined,
              });
            }
            hasPushedReasoningForStep = true;
          }

          // Persist each step's prose in order with its tool parts so a reload
          // shows text and tool activity interleaved, as during streaming.
          if (turnContent.trim()) {
            executedToolParts.push({ type: "text", text: turnContent, state: "done" });
          }
          lastTurnHadText = turnContent.trim().length > 0;

          if (stepError) {
            // Calls the failed pass had started streaming never ran; close their cards
            for (const tc of toolCallsByIndex.values()) {
              if (!tc.hasEmittedStart) continue;
              writer.write({
                type: "tool-output-error",
                toolCallId: tc.effectiveCallId,
                errorText: "",
                dynamic: true,
              });
            }
            interruptedAfterTools = true;
            break;
          }

          const assembledCalls = Array.from(toolCallsByIndex.values()).filter(
            (c) => c.name.trim().length > 0
          );

          const canExecuteMoreTools =
            assembledCalls.length > 0 &&
            (remainingToolRounds > 0 || remainingGraceRounds > 0) &&
            !forceFinalAnswer;

          if (canExecuteMoreTools) {
            // Reset reasoning tracking for next step
            fullReasoning = "";
            reasoningStartTime = null;
            reasoningDurationSec = null;
            hasPushedReasoningForStep = false;

            let graceDirective: string | null = null;

            if (remainingToolRounds > 0) {
              remainingToolRounds -= 1;
            } else if (remainingGraceRounds > 0) {
              const currentGraceRound = MAX_GRACE_TOOL_ROUNDS - remainingGraceRounds + 1;
              remainingGraceRounds -= 1;

              // Strict 3-phase escalation in English
              if (currentGraceRound === 1) {
                graceDirective =
                  "[CRITICAL SYSTEM DIRECTIVE: FINAL GRACE PERIOD - 10 ROUNDS REMAINING]\n" +
                  "Your standard budget of 30 tool rounds has been fully consumed. You have entered a STRICT 10-ROUND EMERGENCY GRACE PERIOD.\n" +
                  "MANDATORY OPERATING RULES:\n" +
                  "1. STRICTLY FORBIDDEN: Starting any new topics, exploratory searches, or unprompted tangents.\n" +
                  "2. FOCUS: Execute ONLY the critical missing steps required to finish the user's primary request.\n" +
                  "3. SPEED: Combine operations where possible. Plan your wrap-up to conclude well before round 40.\n" +
                  "4. If the primary deliverable (document, file, calculation) is already produced, CEASE ALL TOOL CALLS IMMEDIATELY and write your complete final answer now.";
              } else if (remainingGraceRounds === 5) {
                graceDirective =
                  "[URGENT SYSTEM DIRECTIVE: WRAP-UP ENFORCEMENT - ONLY 5 ROUNDS LEFT]\n" +
                  "You are burning through your final emergency rounds. Tool access will be PERMANENTLY TERMINATED in 5 turns.\n" +
                  "ACTIONS REQUIRED NOW:\n" +
                  "1. Immediately commit, save, or write any remaining pending file.\n" +
                  "2. Prepare your final conclusions immediately. Do not make any more investigative tool calls.\n" +
                  "3. This is your last opportunity to finalize deliverables.";
              } else if (remainingGraceRounds === 1) {
                graceDirective =
                  "[FINAL ROUND WARNING: TOOL ACCESS TERMINATING AFTER THIS CALL]\n" +
                  "This is your ABSOLUTE LAST TOOL CALL. After this step, all tool execution will be permanently locked.\n" +
                  "Make this tool call your final conclusive action, and prepare to deliver your complete final response.";
              }
            }

            stepIndex += 1;

            const toolInputs: Array<ToolCallInput & { startedAt: number }> = assembledCalls.map(
              (c, idx) => ({
                id: c.effectiveCallId || c.callId || `call_${idx}`,
                name: c.name,
                arguments: c.args,
                startedAt: c.startedAt || Date.now(),
              })
            );

            // Push assistant turn with its toolCalls before the tool results
            currentMessages.push({
              role: "assistant",
              content: turnContent,
              toolCalls: toolInputs.map(({ id, name, arguments: args }) => ({
                id,
                name,
                arguments: args,
              })),
            });

            for (const tool of toolInputs) {
              const effectiveCallId = tool.id;

              // Malformed or truncated JSON (common when a large payload hits the output
              // token cap) must not run the tool with `{}`: report it so the model can retry.
              let parsedArgs: Record<string, unknown> = {};
              let argsError: string | null = null;
              try {
                parsedArgs = tool.arguments ? JSON.parse(tool.arguments) : {};
              } catch (parseErr) {
                const reason = parseErr instanceof Error ? parseErr.message : "invalid JSON";
                argsError =
                  `Tool arguments are not valid JSON (${reason}; received ${tool.arguments.length} chars, ` +
                  `possibly truncated by the output token limit). Call the tool again with complete, ` +
                  `valid JSON; for large content, send less per call.`;
              }

              const toolStart = tool.startedAt;

              writer.write({
                type: "tool-input-available",
                toolCallId: effectiveCallId,
                toolName: tool.name,
                input: parsedArgs,
                dynamic: true,
                toolMetadata: { startedAt: toolStart },
              });

              const result: ToolExecutionResult = argsError
                ? { success: false, error: { code: "INVALID_PARAM", message: argsError } }
                : await executeTool(tool.name, parsedArgs, {
                    userId: userPublicId,
                    sessionId: sessionPublicId,
                    signal: combinedSignal,
                  });
              const toolEnd = Date.now();
              const toolDurationSec = Math.max(1, Math.round((toolEnd - toolStart) / 1000));

              // Record tool run to database if and only if debug mode is turned on
              if (chatSettings.toolDebug) {
                recordToolExecutionLog({
                  requestId,
                  userId,
                  sessionId,
                  messageId: assistantMessageId,
                  toolCallId: effectiveCallId,
                  toolName: tool.name,
                  success: result.success,
                  errorCode: result.error?.code,
                  errorText: result.error?.message,
                  rawArgs: tool.arguments || undefined,
                  input: parsedArgs,
                  output: result.data,
                  durationMs: toolEnd - toolStart,
                });
              }

              const clientErrorText =
                !result.success && chatSettings.toolDebug
                  ? result.error?.message || "Tool execution failed"
                  : undefined;

              executedToolParts.push({
                type: "dynamic-tool",
                toolCallId: effectiveCallId,
                toolName: tool.name,
                state: result.success ? "output-available" : "output-error",
                durationSec: toolDurationSec,
                startedAt: toolStart,
                endedAt: toolEnd,
                input: parsedArgs,
                output: result.success
                  ? sanitizeToolOutputForStorage(tool.name, result.data)
                  : undefined,
                errorText: clientErrorText,
              });

              if (result.success) {
                writer.write({
                  type: "tool-output-available",
                  toolCallId: effectiveCallId,
                  output: result.data ?? {},
                  dynamic: true,
                  toolMetadata: {
                    durationSec: toolDurationSec,
                    startedAt: toolStart,
                    endedAt: toolEnd,
                  },
                });
              } else {
                writer.write({
                  type: "tool-output-error",
                  toolCallId: effectiveCallId,
                  errorText: clientErrorText ?? "",
                  dynamic: true,
                  toolMetadata: {
                    durationSec: toolDurationSec,
                    startedAt: toolStart,
                    endedAt: toolEnd,
                  },
                });
              }

              currentMessages.push({
                role: "tool",
                toolCallId: effectiveCallId,
                content: JSON.stringify(result.data ?? result.error ?? {}),
              });
            }

            // If a grace period directive triggered on this round, inject it as a strict user turn
            if (graceDirective) {
              currentMessages.push({
                role: "user",
                content: graceDirective,
              });
            }

            // Sync live progress draft & produced files into Redis working memory (~1ms)
            void saveTurnDraftToRedis({
              assistantMessageId: assistantMessageId.toString(),
              assistantMessagePublicId,
              sessionId: sessionId.toString(),
              userId: userId.toString(),
              fullContent,
              fullReasoning,
              parts: executedToolParts,
              status: "completed",
              promptTokens,
              completionTokens,
              updatedAt: new Date().toISOString(),
            });

            const currentFiles = listProducedFiles(executedToolParts);
            if (currentFiles.length > 0) {
              void saveSessionMemoryToRedis(sessionId, {
                filesProduced: currentFiles.map((fn) => ({
                  filename: fn,
                  displayName: fn,
                  createdAt: new Date().toISOString(),
                })),
                lastTurnSummary: `Created/updated ${currentFiles.length} file(s): ${currentFiles.join(", ")}`,
              });
            }

            continue;
          }

          // Check if model ended with an unfulfilled promise to create/save/write a file
          const lowerTurn = turnContent.toLowerCase();
          const seemsUnfulfilledFilePromise =
            stepIndex === 0 &&
            remainingToolRounds > 0 &&
            resolvedModel.supportsTools &&
            (lowerTurn.includes("mari kita simpan") ||
              lowerTurn.includes("mari kita buat file") ||
              lowerTurn.includes("buatkan file html") ||
              lowerTurn.includes("simpan dan buat file"));

          if (seemsUnfulfilledFilePromise && !forceFinalAnswer) {
            stepIndex += 1;
            remainingToolRounds -= 1;
            currentMessages.push({
              role: "assistant",
              content: turnContent,
            });
            currentMessages.push({
              role: "user",
              content: "Panggil tool `write_file` sekarang untuk membuat file lengkapnya.",
            });
            continue;
          }

          // After tool use the model sometimes ends with no prose (empty reply, or more
          // tool calls once the round budget is spent). Give it one tool-free pass to answer.
          const endedWithoutAnswer =
            stepIndex > 0 && (assembledCalls.length > 0 || !turnContent.trim());
          if (endedWithoutAnswer && !forceFinalAnswer) {
            forceFinalAnswer = true;
            stepIndex += 1;
            // A user turn, since some providers reject system messages mid-conversation
            currentMessages.push({
              role: "user",
              content:
                "Do not call any more tools. Using the tool results above, write your complete final answer to the user now.",
            });
            continue;
          }

          break;
        }

        // Tools did the work but no closing prose came (empty final pass or a failed one):
        // finish with a reply built from the tool results instead of leaving the turn hanging
        if (!lastTurnHadText && hasSuccessfulToolResult(executedToolParts)) {
          const fallbackText = buildFallbackAnswer(executedToolParts, interruptedAfterTools);
          const fallbackPartId = `text_${assistantMessagePublicId}_fallback`;
          writer.write({ type: "text-start", id: fallbackPartId });
          writer.write({ type: "text-delta", id: fallbackPartId, delta: fallbackText });
          writer.write({ type: "text-end", id: fallbackPartId });
          fullContent += (fullContent.trim() ? "\n\n" : "") + fallbackText;
          executedToolParts.push({ type: "text", text: fallbackText, state: "done" });
        }

        // If reasoning was executed, append reasoning-meta so duration survives page reloads
        if (reasoningDurationSec !== null) {
          executedToolParts.push({
            type: "reasoning-meta",
            durationSec: reasoningDurationSec,
          });
        }

        // Persist final completed message via Redis-first write-behind flush
        await flushTurnToDatabase({
          assistantMessageId: assistantMessageId.toString(),
          assistantMessagePublicId,
          sessionId: sessionId.toString(),
          userId: userId.toString(),
          fullContent,
          fullReasoning: fullReasoning || null,
          parts: executedToolParts,
          status: "completed",
          promptTokens,
          completionTokens,
          updatedAt: new Date().toISOString(),
        });

        // Always record usage (priced from the model's catalog rates) so requestCount moves even at $0
        billedModel = null;
        await recordUserUsage(userId, {
          promptTokens,
          completionTokens,
          model: {
            id: resolvedModel.id,
            inputPricePerMillion: resolvedModel.inputPricePerMillion,
            outputPricePerMillion: resolvedModel.outputPricePerMillion,
          },
          sessionId,
          messageId: assistantMessageId,
          requestId,
        }).catch((err) => {
          console.error("[USAGE_RECORD_ERROR]", err);
        });

        writer.write({
          type: "finish",
          finishReason: "stop",
        });
        writer.setOutcome({ status: "completed" });
      } catch (streamErr: unknown) {
        const errAny = streamErr as Record<string, unknown>;
        const isAbort =
          combinedSignal.aborted ||
          errAny?.message === "CLIENT_ABORTED" ||
          errAny?.errorClass === "client_aborted";

        const isUpstreamRateLimit =
          isUpstreamRateLimitText(fullContent) ||
          (streamErr instanceof GatewayError && streamErr.errorClass === "rate_limited");

        const finalStatus = isAbort ? "aborted" : "failed";
        const errorCode = isAbort
          ? "CLIENT_ABORTED"
          : isUpstreamRateLimit
            ? "RATE_LIMITED"
            : (errAny?.code as string) || (errAny?.errorClass as string) || "STREAM_ERROR";

        await flushTurnToDatabase({
          assistantMessageId: assistantMessageId.toString(),
          assistantMessagePublicId,
          sessionId: sessionId.toString(),
          userId: userId.toString(),
          fullContent: isUpstreamRateLimit ? "" : fullContent,
          fullReasoning: isUpstreamRateLimit ? null : fullReasoning || null,
          parts: executedToolParts,
          status: finalStatus,
          errorCode,
          promptTokens,
          completionTokens,
          updatedAt: new Date().toISOString(),
        });

        if (billedModel && !isUpstreamRateLimit) {
          await recordPartialUsage(userId, {
            promptTokens, completionTokens, model: billedModel, sessionId, messageId: assistantMessageId, requestId,
            generatedChars: fullContent.length + fullReasoning.length,
            promptChars: estimatePromptChars,
          });
        }

        if (isAbort) {
          writer.write({
            type: "abort",
            reason: "Client stopped generation",
          });
          writer.setOutcome({ status: "aborted" });
        } else {
          let publicMessage = "The model is temporarily unavailable.";

          if (streamErr instanceof ApiError) {
            publicMessage = streamErr.message;
          } else if (streamErr instanceof GatewayError) {
            publicMessage = streamErr.message || "The model is temporarily unavailable.";
          }

          writer.write({
            type: "error",
            errorText: publicMessage,
          });
          writer.setOutcome({ status: "failed", error: streamErr });
        }
      } finally {
        cleanup();
        await onSettled?.().catch(() => {});
      }
    },
  });

  return startStreamHub(sessionPublicId, assistantMessagePublicId, source);
}
