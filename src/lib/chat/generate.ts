import { db } from "@/lib/db";
import { Prisma } from "@/generated/client";
import { ApiError } from "@/lib/api/response";
import { GatewayError, isUpstreamRateLimitText } from "@/lib/routing/errors";
import { getRoutingSettings } from "@/lib/routing/settings";
import { executeWithFallback } from "@/lib/routing/executor";
import { devnubyTools, executeTool, type ToolExecutionResult } from "@/lib/tools";
import { sanitizeToolOutputForStorage } from "@/lib/tools/compact-source";
import { recordUserUsage } from "@/lib/chat/quota";
import { assertUserModelAccess } from "@/lib/chat/model-access";
import { registerStream, unregisterStream } from "@/lib/chat/active-streams";
import { startStreamHub } from "@/lib/chat/stream-hub";
import { getChatSettings } from "@/lib/chat/settings";
import { recordToolExecutionLog } from "@/lib/chat/tool-log";
import { DEFAULT_TIME_ZONE } from "@/lib/chat/timezone";
import { buildSystemPrompt } from "@/lib/chat/system-prompts";
import { formatFileSize } from "@/lib/files/policy";
import type {
  ChatMessageInput,
  ReasoningEffortVariant,
  ToolCallInput,
} from "@/lib/gateways/types";
import {
  createUIMessageStream,
  smoothStream,
  toUIMessageChunk,
  type TextStreamPart,
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
  /** Validated IANA zone of the user (see `resolveClientTimeZone`) */
  clientTimeZone?: string;
  requestId: string;
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
  name: string;
  args: string;
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

  resolvedModelCache.set(candidatePublicId, {
    model,
    expiresAt: now + 30_000,
  });

  return model;
}

/**
 * Adapts raw TextStreamParts into a smoothed word-by-word stream using AI SDK's smoothStream helper.
 * Buffers are flushed with a sentinel step finish chunk on completion.
 */
async function* createSmoothedTextPipeline(
  source: AsyncIterable<TextStreamPart<Record<string, never>>>
): AsyncIterable<TextStreamPart<Record<string, never>>> {
  const smoother = smoothStream<Record<string, never>>({
    delayInMs: 10,
    chunking: "word",
  })({ tools: {} });

  const writer = smoother.writable.getWriter();
  const reader = smoother.readable.getReader();

  const feeder = (async () => {
    try {
      for await (const chunk of source) {
        await writer.write(chunk);
      }
      await writer.close();
    } catch (err) {
      try {
        await writer.abort(err);
      } catch {}
    }
  })();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {}
    await feeder.catch(() => {});
  }
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
    clientTimeZone,
    requestId,
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

        // Parallelize initial DB lookups (sessionFiles, user, chatSettings) to minimize TTFT
        const [sessionFiles, user, chatSettings] = await Promise.all([
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
        ]);

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
              "- Sandbox has NO internet/network access and NO access to session files.",
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

        const executedToolParts: Record<string, unknown>[] = [];
        // Round budget is admin-managed (app_settings `chat.max_tool_rounds`)
        let remainingToolRounds = chatSettings.maxToolRounds;
        let stepIndex = 0;
        let reasoningStartTime: number | null = null;
        let reasoningDurationSec: number | null = null;
        // Set once the model must answer in prose from what it already gathered
        let forceFinalAnswer = false;

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
              tools: resolvedModel.supportsTools ? devnubyTools : undefined,
              toolChoice,
              signal: combinedSignal,
            },
          });

          const toolCallsByIndex = new Map<number | string, AccumulatedToolCall>();
          let turnContent = "";

          const textPartId = `text_${assistantMessagePublicId}_${stepIndex}`;
          const reasoningPartId = `reasoning_${assistantMessagePublicId}_${stepIndex}`;
          let hasEmittedTextStart = false;
          let hasEmittedReasoningStart = false;
          let hasEndedReasoning = false;

          // Bridge gateway events to TextStreamParts for smoothStream
          async function* rawTextPartsGenerator(): AsyncIterable<
            TextStreamPart<Record<string, never>>
          > {
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
                if (hasEmittedReasoningStart && !hasEndedReasoning) {
                  hasEndedReasoning = true;
                  if (reasoningStartTime) {
                    reasoningDurationSec = Math.max(1, Math.round((Date.now() - reasoningStartTime) / 1000));
                  }
                  yield { type: "reasoning-end", id: reasoningPartId };
                }
                if (!hasEmittedTextStart) {
                  hasEmittedTextStart = true;
                  yield { type: "text-start", id: textPartId };
                }
                yield { type: "text-delta", id: textPartId, text: event.text };
              } else if (event.type === "reasoning") {
                if (reasoningStartTime === null) {
                  reasoningStartTime = Date.now();
                }
                fullReasoning += event.text;
                if (!hasEmittedReasoningStart) {
                  hasEmittedReasoningStart = true;
                  yield { type: "reasoning-start", id: reasoningPartId };
                }
                yield {
                  type: "reasoning-delta",
                  id: reasoningPartId,
                  text: event.text,
                };
              } else if (event.type === "tool_call") {
                const key =
                  event.index !== undefined ? event.index : event.callId || "call_0";
                const existing = toolCallsByIndex.get(key) || {
                  callId: event.callId || "",
                  name: event.name || "",
                  args: "",
                };
                if (event.callId && !existing.callId) existing.callId = event.callId;
                if (event.name && !existing.name) existing.name = event.name;
                existing.args += event.argumentsDelta;
                toolCallsByIndex.set(key, existing);
              } else if (event.type === "usage") {
                promptTokens += event.promptTokens;
                completionTokens += event.completionTokens;
              }
            }

            if (hasEmittedReasoningStart && !hasEndedReasoning) {
              if (reasoningStartTime) {
                reasoningDurationSec = Math.max(1, Math.round((Date.now() - reasoningStartTime) / 1000));
              }
              yield { type: "reasoning-end", id: reasoningPartId };
            }
            if (hasEmittedTextStart) {
              yield { type: "text-end", id: textPartId };
            }
          }

          // Consume smoothed text/reasoning parts and emit AI SDK UI chunks
          for await (const smoothedPart of createSmoothedTextPipeline(
            rawTextPartsGenerator()
          )) {
            if (combinedSignal.aborted) {
              throw new Error("CLIENT_ABORTED");
            }
            const chunk = toUIMessageChunk(smoothedPart, { sendReasoning: true });
            if (chunk) {
              writer.write(chunk);
            }
          }

          // Persist each step's prose in order with its tool parts so a reload
          // shows text and tool activity interleaved, as during streaming.
          if (turnContent.trim()) {
            executedToolParts.push({ type: "text", text: turnContent, state: "done" });
          }

          const assembledCalls = Array.from(toolCallsByIndex.values()).filter(
            (c) => c.name.trim().length > 0
          );

          if (assembledCalls.length > 0 && remainingToolRounds > 0 && !forceFinalAnswer) {
            remainingToolRounds -= 1;
            stepIndex += 1;

            const toolInputs: ToolCallInput[] = assembledCalls.map((c, idx) => ({
              id: c.callId || `call_${idx}`,
              name: c.name,
              arguments: c.args,
            }));

            // Push assistant turn with its toolCalls before the tool results
            currentMessages.push({
              role: "assistant",
              content: turnContent,
              toolCalls: toolInputs,
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

              const toolStart = Date.now();

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
                errorText: result.success ? undefined : result.error?.message,
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
                  errorText: result.error?.message || "Tool execution failed",
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

        // If reasoning was executed, append reasoning-meta so duration survives page reloads
        if (reasoningDurationSec !== null) {
          executedToolParts.push({
            type: "reasoning-meta",
            durationSec: reasoningDurationSec,
          });
        }

        // Persist final completed message to DB
        await db.chatMessage.update({
          where: { id: assistantMessageId },
          data: {
            content: fullContent,
            reasoning: fullReasoning || null,
            parts:
              executedToolParts.length > 0
                ? (executedToolParts as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            status: "completed",
            promptTokens: promptTokens || null,
            completionTokens: completionTokens || null,
          },
        });

        // Always record usage to increment requestCount even if token metrics were zero
        await recordUserUsage(userId, { promptTokens, completionTokens }).catch((err) => {
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

        await db.chatMessage
          .update({
            where: { id: assistantMessageId },
            data: {
              content: isUpstreamRateLimit ? "" : fullContent,
              reasoning: isUpstreamRateLimit ? null : fullReasoning || null,
              status: finalStatus,
              errorCode,
              promptTokens: promptTokens || null,
              completionTokens: completionTokens || null,
            },
          })
          .catch(() => {});

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
      }
    },
  });

  return startStreamHub(sessionPublicId, assistantMessagePublicId, source);
}
