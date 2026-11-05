import { db } from "@/lib/db";
import { Prisma } from "@/generated/client";
import { ApiError } from "@/lib/api/response";
import { GatewayError, isUpstreamRateLimitText } from "@/lib/routing/errors";
import { getRoutingSettings } from "@/lib/routing/settings";
import { executeWithFallback } from "@/lib/routing/executor";
import { devnubyTools, executeTool, type ToolExecutionResult } from "@/lib/tools";
import { isExecCommandAvailable } from "@/executors";
import { buildSafetyRefusal, screenUserRequest } from "@/lib/safety/classifier";
import { sanitizeToolOutputForStorage } from "@/lib/tools/compact-source";
import { buildSkillsSystemPromptBlock } from "@/lib/skills/runtime";
import {
  chargeLiveUsage,
  finalTurnTokens,
  settleLiveUsage,
  toQuotaPayload,
  windowsFromLedger,
  type PlanLimits,
} from "@/lib/chat/quota";
import type { LiveLedger } from "@/lib/chat/live-quota";
import { registerStream, unregisterStream } from "@/lib/chat/active-streams";
import { startStreamHub } from "@/lib/chat/stream-hub";
import { getChatSettings } from "@/lib/chat/settings";
import { recordToolExecutionLog } from "@/lib/chat/tool-log";
import { buildUserMemoryPrompt, getUserMemoryNotes } from "@/lib/chat/user-memory";
import { DEFAULT_MEMORY_SETTINGS, getMemorySettings } from "@/lib/chat/memory-settings";
import { buildFallbackAnswer, hasSuccessfulToolResult, listProducedFiles } from "@/lib/chat/turn-recovery";
import {
  completeTurn,
  saveSessionMemoryToRedis,
  saveTurnProgress,
  type PendingTurn,
  type TurnStatus,
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
  /** Display name for the admin system prompt (from the session, no lookup) */
  userName: string;
  sessionId: bigint;
  sessionPublicId: string;
  /** Project of the chat; null skips the project-context lookup */
  projectInternalId: bigint | null;
  /** The Redis-held turn this generation fills in and finally stores */
  turn: PendingTurn;
  /** Already resolved and access-checked by the route */
  resolvedModel: ResolvedModel;
  /** Effective plan limits, for the live quota updates sent to the client */
  planLimits: PlanLimits | null;
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
  /** Runs once, when the model's first token (text, reasoning or tool call) arrives */
  onFirstModelToken?: () => void;
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

export type ResolvedModel = Prisma.CatalogModelGetPayload<{ select: typeof resolvedModelSelect }>;
const resolvedModelCache = new Map<string, { model: ResolvedModel; expiresAt: number }>();

/** Memory settings + notes for one turn; settings off skips the notes lookup entirely. */
async function loadTurnMemory(userId: bigint) {
  const settings = await getMemorySettings(userId);
  const notes = settings.memoryEnabled ? await getUserMemoryNotes(userId) : [];
  return { settings, notes };
}

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

/** Minimum gap between mid-stream live quota charges (estimates between usage reports). */
const LIVE_QUOTA_INTERVAL_MS = 1500;

/**
 * Core AI SDK UI message stream generator. Runs the multi-turn tool loop against the
 * DB-driven smart routing executor (executeWithFallback), translates gateway events
 * to AI SDK UIMessageChunks with word smoothing, executes tools, charges spend to the
 * live quota ledger as it streams, and finally stores the Redis-held turn in Postgres.
 */
export function createChatGenerationStream(
  options: StreamGenerationOptions
): ReadableStream<UIMessageChunk> {
  const {
    userId,
    userPublicId,
    userName,
    sessionId,
    sessionPublicId,
    projectInternalId,
    turn,
    resolvedModel,
    planLimits,
    reasoningEffort,
    forceWebSearch,
    conversationHistory,
    mentionedSourceIds,
    clientTimeZone,
    requestId,
    onSettled,
    onFirstModelToken,
  } = options;
  const assistantMessagePublicId = turn.assistant.publicId;
  // Live quota cursor; regenerations reuse the message id, so the turn start makes it unique
  const liveUsageId = `${assistantMessagePublicId}:${turn.startedAt}`;

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
      let estimatePromptChars = () => 0;
      let firstTokenSeen = false;

      // ── Live quota: charge spend while the reply streams ──
      // Between usage reports the running step is estimated (~4 chars/token); the
      // ledger only ever grows here and is corrected to the exact price at the end.
      let stepPromptChars = 0;
      let stepGeneratedChars = 0;
      let stepUsageReported = false;
      let lastLiveChargeAt = 0;
      const emitQuota = (ledger: LiveLedger | null) => {
        if (!ledger) return;
        writer.write({
          type: "data-quota",
          data: toQuotaPayload(windowsFromLedger(ledger, planLimits)),
          transient: true,
        });
      };
      const chargeLive = (force = false) => {
        const now = Date.now();
        if (!force && now - lastLiveChargeAt < LIVE_QUOTA_INTERVAL_MS) return;
        lastLiveChargeAt = now;
        const pending = stepUsageReported ? 0 : 1;
        void chargeLiveUsage(
          userId,
          liveUsageId,
          promptTokens + pending * Math.ceil(stepPromptChars / 4),
          completionTokens + pending * Math.ceil(stepGeneratedChars / 4),
          resolvedModel
        )
          .then(emitQuota)
          .catch(() => {});
      };
      const noteFirstToken = () => {
        if (firstTokenSeen) return;
        firstTokenSeen = true;
        onFirstModelToken?.();
      };

      // ── Turn state held in Redis until the turn is stored ──
      const fillTurn = (
        status: TurnStatus,
        errorCode: string | null,
        blankContent = false,
        errorDetail: string | null = null
      ) => {
        turn.assistant = {
          ...turn.assistant,
          content: blankContent ? "" : fullContent,
          reasoning: blankContent ? null : fullReasoning || null,
          parts: executedToolParts,
          status,
          errorCode,
          // The real trace stays server-side; `content` is the only text the user ever sees
          errorDetail,
          requestId: errorDetail ? requestId : null,
          promptTokens,
          completionTokens,
        };
      };
      const finishTurn = async (billed: { promptTokens: number; completionTokens: number } | null) => {
        const ledger = await settleLiveUsage(
          userId,
          liveUsageId,
          billed ? { ...billed, model: resolvedModel } : null
        ).catch(() => null);
        emitQuota(ledger);
        turn.usage = billed
          ? {
              ...billed,
              inputPricePerMillion: resolvedModel.inputPricePerMillion.toString(),
              outputPricePerMillion: resolvedModel.outputPricePerMillion.toString(),
            }
          : null;
        await completeTurn(turn);
      };

      const cleanup = () => {
        unregisterStream(assistantMessagePublicId, streamController);
      };

      try {
        // 1. Emit start chunk with assistant messageId and meta
        writer.write({
          type: "start",
          messageId: assistantMessagePublicId,
          messageMetadata: {
            messageId: assistantMessagePublicId,
            userMessageId: turn.user?.publicId ?? "",
            model: resolvedModel.publicId,
            requestId,
          },
        });

        // Safety gate (admin-configured classifier model): clearly illegal or harmful requests
        // get a fixed refusal and never reach the chat model's provider. It runs alongside
        // the prompt assembly below and is awaited before the first model call.
        const safetyCheck = screenUserRequest({
          conversation: conversationHistory,
          requestId,
          userId,
          signal: combinedSignal,
        });
        safetyCheck.catch(() => {});

        // Collect executed tool call parts to persist to DB so widgets & tool outputs survive page reloads
        const currentMessages: ChatMessageInput[] = [...conversationHistory];
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

        // Parallelize initial lookups (sessionFiles, chatSettings, project, memory) to minimize TTFT
        const [sessionFiles, chatSettings, sessionProject, memory] = await Promise.all([
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
          resolvedModel.supportsTools
            ? getChatSettings()
            : Promise.resolve({ maxToolRounds: 0, toolDebug: false }),
          projectInternalId !== null ? loadSessionProject(sessionId) : Promise.resolve(null),
          // Redis-cached; a memory outage must not block the reply
          loadTurnMemory(userId).catch((err) => {
            console.warn(`[USER_MEMORY_LOAD_FAILED] [${requestId}]`, err);
            return { settings: DEFAULT_MEMORY_SETTINGS, notes: [] };
          }),
        ]);
        const memoryEnabled = memory.settings.memoryEnabled;

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

        // Tools the current chat can't use are dropped: `read_project_source` outside a
        // project, `memory_note` when memory is off, `search_past_chats` when the user
        // hasn't allowed searching earlier chats (Settings → Memory), `exec_command` on hosts
        // without the OS sandbox (e.g. local Windows development)
        const execCommandAvailable = await isExecCommandAvailable();
        const availableTools = devnubyTools.filter(
          (t) =>
            (t.name !== "read_project_source" || Boolean(sessionProject?.files.length)) &&
            (t.name !== "memory_note" || memoryEnabled) &&
            (t.name !== "search_past_chats" || memory.settings.chatSearchEnabled) &&
            (t.name !== "exec_command" || execCommandAvailable)
        );

        // If tools are supported, inject comprehensive tool guidelines and active session files
        if (resolvedModel.supportsTools) {
          currentMessages.unshift({
            role: "system",
            content: [
              "# Tools & Operating Protocol",
              "",
              "## 1. Document & Visual Image Inspection (`read_file`)",
              "- You have persistent access to files and images in this chat session via `read_file`. ALWAYS use `read_file` when the user asks about an uploaded document, previous file, page count, specific facts, or when you need to visually inspect a rendered image (`.png`, `.jpg`, `.webp`).",
              "- Visual Inspection of Images: Calling `read_file` on any `.png`, `.jpg`, `.jpeg`, or `.webp` in session storage (including page previews rendered by `convert_pdf_to_images.py` or illustrations created by `generate_image`) automatically attaches the rendered image directly to your multimodal vision input so you can SEE the layout, typography, contrast, and image proportions with your own eyes!",
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
              "- If the user asks to create, edit, or analyze a DOCX/XLSX/PPTX/PDF file they uploaded: DO NOT use `execute_code`. Use `load_skill` + `run_skill_script` (or fallback tools `create_document`, `create_spreadsheet`, `create_presentation`, `read_file`) instead.",
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
              "- Use `memory_note` with action 'save' to remember user preferences/facts that should persist across sessions; 'list' to read notes in full (and their ids); 'delete' to remove. Only store facts the user explicitly wants retained.",
              "- The newest saved notes are already in the 'User Memory' system message: use them directly instead of calling 'list' first.",
              "",
              "## 7b. Searching Earlier Chats (`search_past_chats`)",
              "- When the user refers to something from a previous chat that is not in this conversation ('like we discussed', 'the plan we made', 'what did I say about'), call `search_past_chats` with a few keywords instead of guessing.",
              "- Quote what you found and name the chat it came from. If nothing matches, say so.",
              "",
              "## 8. Surgical File Editing (`edit_file`) & Creation (`write_file`)",
              "- When modifying an existing text or code file (.html, .css, .js, .ts, .md, .csv, .json, .py, etc.), PREFER calling `edit_file` with `targetText` (or `startLine`/`endLine`) and `replacementText`. This performs a precise, surgical diff edit on the exact same file without rewriting the whole document.",
              "- Use `write_file` when creating a brand-new file from scratch or when completely rewriting an entire document.",
              "- When editing, `edit_file` updates the exact same file in session storage and returns a unified diff.",
              "- If the user asks to revert or undo a change, you can call `edit_file` to invert the diff or restore the previous text snippet.",
              "- Do NOT edit raw binary files with `edit_file`.",
              "",
              "## 9. Creating & Editing Office / PDF Documents (Skills-First Architecture + Layperson-Friendly Output)",
              "- TREAT EVERY USER AS A NON-DEVELOPER / LAYPERSON: Always assume the user is a general layperson who does NOT know HTML, web development, Python, or programming libraries. NEVER create `.html` files when a user asks for a document, poster, assignment, table, or presentation unless they explicitly ask for HTML/website code! NEVER mention internal technical jargon (`reportlab`, `pypdf`, `openpyxl`, `python`, `script`, `font belum terdaftar di lingkungan ini`, `render PNG`, `piksel`) in your user-facing chat response — speak naturally in simple everyday language.",
              "- PRIMARY WORKFLOW (`.devnuby/skills` + `run_skill_script`): Always check `Specialized AI Skills (.devnuby/skills)` first whenever the user asks to create, edit, inspect, or fill `.pdf`, `.docx`, `.xlsx`, or `.pptx` files.",
              "  * PDF (.pdf) & Word (.docx): When `pdf` or `docx` exists in `.devnuby/skills`, ALWAYS call `load_skill` (`pdf` or `docx`) first, then call `run_skill_script` (`runtime: 'python'` with `reportlab`/`pypdf`/`pdfplumber` or `scripts/*.py` for PDF; `runtime: 'node'` with `require('docx')` or `scripts/*.py` for DOCX).",
              "  * Excel (.xlsx): When `xlsx` exists in `.devnuby/skills`, ALWAYS call `load_skill` (`xlsx`) first, then call `run_skill_script` (`runtime: 'python'` with `openpyxl` or `pandas`).",
              "  * PowerPoint (.pptx): When `pptx` exists in `.devnuby/skills`, ALWAYS call `load_skill` (`pptx`) first, then call `run_skill_script` (`runtime: 'node'` with `require('pptxgenjs')` or `scripts/*.py`).",
              "  * NEVER STOP MID-WORKFLOW OR ROLEPLAY TOOL EXECUTION: Never end your turn after saying 'Saya buat PDF-nya sekarang' or 'Skill PDF sudah aktif' without calling `run_skill_script` in that exact turn! Never pretend or claim in plain text that a file was created/updated without actually executing `run_skill_script` (or `write_file`).",
              "  * SINGLE FINAL DELIVERABLE RULE (NEVER SEND RAW/PARTIAL FILES TO USER): The user must ONLY ever receive the 1 final completed document! When building a long multi-page document (e.g., answering 5+ exam questions + poster + justification + bibliography), you may pass structured text via `inputFiles: {'content.json': '...'}` OR build modular raw parts across 2–3 fast `run_skill_script` calls. If you build modular parts across multiple steps, ALWAYS prefix temporary raw files with `_part` (e.g. `_part1_answers.pdf`, `_part2_justifikasi.pdf`), merge them into the single final PDF using `pypdf.PdfWriter`, and delete all `_part*.pdf` files (`os.remove(...)`) in the merge script so only the final PDF is delivered!",
              "  * STRICT ZERO IDENTITY HALLUCINATION RULE: NEVER invent, guess, or fabricate personal identity details (person/student names, NIM/NPM, employee IDs, institutions, class codes, phone numbers, emails, or signatures) when not explicitly given by the user! Always use clean placeholders such as `[Nama Lengkap]` and `[NIM / NPM]` (or `..............................`) and remind the user to fill them in.",
              "  * POSTERS = PURE AI IMAGE GENERATOR (`generate_image`): When the user asks for a poster (standalone or inside a combined PDF assignment), ALWAYS use `generate_image` (`aspectRatio: '3:4'` or `'9:16'`, `filename: 'poster_edukasi.png'`) with a well-planned visual concept, hierarchy, illustration, and accurate headline/points to generate the complete visual poster directly with the AI image generator (never draw manual boxes/stick-figures in `reportlab`). If the poster is part of a combined PDF assignment, embed `poster_edukasi.png` full-page onto the poster page inside the single final PDF!",
              "  * FALLBACK ONLY (`create_document`, `create_spreadsheet`, `create_presentation`): ONLY use these legacy tools if no matching skill exists in `.devnuby/skills/` or if `run_skill_script` is unavailable in an emergency. NEVER write fake mock binary strings into `write_file`. If a `run_skill_script` call returns an error, silently fix your script and re-run it — NEVER paste raw stack traces, error codes, or file paths to the user.",
              "",
              ...(execCommandAvailable
                ? [
                    "## 9b. Real Linux Workspace (`exec_command`)",
                    "- `exec_command` runs any bash command in this chat's private, persistent `/workspace` on a real Linux machine (the user's uploaded files are already there). Use it freely whenever a task needs real tools: converting between formats (LibreOffice `soffice --headless --convert-to`, pandoc), rendering PDF pages to images (`pdftoppm`), OCR (`tesseract`), merging/splitting PDFs (`qpdf`), image processing (ImageMagick), data work with pandas, unzipping archives, or installing a missing library with `pip install` / `npm install`.",
                    "- `run_skill_script` and `exec_command` share the same `/workspace`, so you can mix them: build a document with the skill, then convert, inspect, or post-process it with `exec_command`.",
                    "- Work step by step: run a command, read its output, fix and re-run. Verify your deliverable (e.g. `pdfinfo`, `pdftoppm -png -r 60` + `read_file`) before telling the user it is done.",
                    "- The user only ever sees FINAL deliverables. Every helper script, preview render, check output, or intermediate part must be named with a leading `_` (`_build_report.py`, `_check/page-1.png`, `_part1.pdf`): those are hidden from the user but stay in `/workspace`, and `read_file` can open them for your own inspection. Create helper scripts inside `exec_command` (heredoc), never with `write_file`. Delete large temporary files when done (disk is limited per user).",
                    "- Never show commands, paths, or raw errors to the user; describe the result in plain language.",
                    "",
                  ]
                : []),
              "## 10. Generating Images & Posters (`generate_image`)",
              "- When the user asks to generate, draw, illustrate, design, or create an image, poster, flyer, infographic, illustration, photo, logo, or icon:",
              "  * ALWAYS call `generate_image` with a rich visual prompt describing subject, layout hierarchy, composition, lighting, and style.",
              "  * For standalone posters or poster pages in assignments, use `aspectRatio: '3:4'` (A4 portrait proportion) or `'9:16'` so the AI image generator produces a complete, publication-ready visual poster.",
              "  * When generating a background/spot illustration to place next to body text in a slide/document, include `'no text, no words, no letters anywhere'` in your `generate_image` prompt.",
              "  * If the user asks for a transparent background, cutout, sticker, or logo without background, set `transparentBackground: true`. The system automatically isolates the subject into an authentic transparent PNG.",
              "  * Do NOT use `write_file`, HTML, or mock base64 for images/posters; use `generate_image` so real high-resolution visuals are rendered.",
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

        // Long-term memory from earlier chats, so the model doesn't depend on calling `list`
        const memoryPrompt = memoryEnabled ? buildUserMemoryPrompt(memory.notes) : null;
        if (memoryPrompt) {
          currentMessages.unshift({ role: "system", content: memoryPrompt });
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
          userName,
        });
        if (adminPrompt) {
          currentMessages.unshift({ role: "system", content: adminPrompt });
        }

        const safetyVerdict = await safetyCheck;
        if (safetyVerdict?.blocked) {
          console.warn(`[SAFETY_GATE_BLOCKED] [${requestId}] user=${userId} category=${safetyVerdict.category ?? "-"}`);
          const refusal = buildSafetyRefusal(safetyVerdict.language);
          const refusalPartId = `text_${assistantMessagePublicId}_safety`;
          writer.write({ type: "text-start", id: refusalPartId });
          writer.write({ type: "text-delta", id: refusalPartId, delta: refusal });
          writer.write({ type: "text-end", id: refusalPartId });
          fullContent = refusal;
          fillTurn("completed", null);
          await finishTurn(null);
          writer.write({ type: "finish", finishReason: "stop" });
          writer.setOutcome({ status: "completed" });
          return;
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
        let stepErrorRetries = 0;
        let unfulfilledPromiseNudges = 0;

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

          stepPromptChars = estimatePromptChars();
          stepGeneratedChars = 0;
          stepUsageReported = false;

          const gatewayStream = executeWithFallback({
            publicModelId: resolvedModel.publicId,
            requestId,
            userId,
            messageId: assistantMessagePublicId,
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

            if (event.type === "delta" || event.type === "reasoning" || event.type === "tool_call") {
              noteFirstToken();
              stepGeneratedChars +=
                event.type === "tool_call" ? (event.argumentsDelta?.length ?? 0) : event.text.length;
              chargeLive();
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
              // Real figures for this step replace its estimate on the live ledger
              stepUsageReported = true;
              chargeLive(true);
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

            // If we still have tool budget and the client hasn't aborted, auto-recover instead of
            // breaking out and leaving the user with only "Saya buat PDF-nya sekarang..."!
            if (
              !combinedSignal.aborted &&
              stepErrorRetries < 2 &&
              (remainingToolRounds > 0 || remainingGraceRounds > 0) &&
              !forceFinalAnswer
            ) {
              stepErrorRetries += 1;
              stepIndex += 1;
              if (remainingToolRounds > 0) remainingToolRounds -= 1;
              else if (remainingGraceRounds > 0) remainingGraceRounds -= 1;

              if (turnContent.trim()) {
                currentMessages.push({
                  role: "assistant",
                  content: turnContent,
                });
              }
              currentMessages.push({
                role: "user",
                content:
                  "[SYSTEM RECOVERY: Your previous response/tool call stream was interrupted (likely because the single script payload was too long). Do NOT repeat preliminary searches or re-read files you already read. Immediately execute your pending file-creation step via `run_skill_script` NOW — if the document is large, split it into smaller modular steps (e.g. build `part1.pdf`, then `part2.pdf`, then merge with `pypdf.PdfWriter`) or pass large text via `inputFiles`.]",
              });
              continue;
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

            const pendingVisionInspections: Array<{ filename: string; dataUrl: string }> = [];

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
                  `valid JSON; for large content, split into modular calls or pass data via inputFiles.`;
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
                    userInternalId: userId,
                    sessionInternalId: sessionId,
                    signal: combinedSignal,
                    // Live document preview: the files panel opens what the script just wrote
                    onProgress: (progress) => {
                      if (progress.type !== "document-ready") return;
                      const params = new URLSearchParams({
                        path: progress.path,
                        v: String(progress.version),
                      });
                      writer.write({
                        type: "data-live-document",
                        data: {
                          toolCallId: effectiveCallId,
                          path: progress.path,
                          sizeBytes: progress.sizeBytes,
                          version: progress.version,
                          url: `/api/v1/chats/${sessionPublicId}/live-document?${params.toString()}`,
                        },
                        transient: true,
                      });
                    },
                  });
              const toolEnd = Date.now();
              const toolDurationSec = Math.max(1, Math.round((toolEnd - toolStart) / 1000));

              // Extract transient visualDataUrl from read_file on images before logging/streaming
              if (
                tool.name === "read_file" &&
                result.success &&
                result.data &&
                typeof result.data === "object" &&
                typeof (result.data as Record<string, unknown>).visualDataUrl === "string"
              ) {
                const dataRec = result.data as Record<string, unknown>;
                const dataUrl = String(dataRec.visualDataUrl);
                const imgName = String(dataRec.filename || parsedArgs.filename || "image.png");
                delete dataRec.visualDataUrl;
                if (resolvedModel.supportsVision && dataUrl.startsWith("data:image/")) {
                  pendingVisionInspections.push({ filename: imgName, dataUrl });
                }
              }

              // Record tool run to database if and only if debug mode is turned on
              if (chatSettings.toolDebug) {
                recordToolExecutionLog({
                  requestId,
                  userId,
                  sessionId,
                  messageId: assistantMessagePublicId,
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

            // Inject multimodal image parts for any images inspected via `read_file`
            if (pendingVisionInspections.length > 0 && resolvedModel.supportsVision) {
              currentMessages.push({
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `[Visual Inspection: ${pendingVisionInspections.map((v) => v.filename).join(", ")} — examine layout, typography, contrast, and proportions directly]:`,
                  },
                  ...pendingVisionInspections.map((v) => ({
                    type: "image_url" as const,
                    image_url: { url: v.dataUrl },
                  })),
                ],
              });
            }

            // If a grace period directive triggered on this round, inject it as a strict user turn
            if (graceDirective) {
              currentMessages.push({
                role: "user",
                content: graceDirective,
              });
            }

            // Sync live progress & produced files into Redis (~1ms); doubles as a liveness heartbeat
            fillTurn("streaming", null);
            void saveTurnProgress(turn);

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

          // Check if model ended with an unfulfilled promise to create/save/write a file,
          // loaded a document skill without producing any document, or roleplayed creating a file without calling tools.
          const producedFilesSoFar = listProducedFiles(executedToolParts);
          const producedOfficeOrPdfDoc = producedFilesSoFar.some((f) =>
            /\.(?:pdf|docx|dotx|xlsx|xlsm|pptx|potx)$/i.test(f)
          );
          const loadedDocSkill = executedToolParts.some(
            (p) =>
              p.type === "dynamic-tool" &&
              p.toolName === "load_skill" &&
              p.state === "output-available" &&
              /^(?:pdf|docx|xlsx|pptx)$/i.test(
                String((p.input as Record<string, unknown> | undefined)?.name ?? "")
              )
          );
          const ranAnyCreationTool = executedToolParts.some(
            (p) =>
              p.type === "dynamic-tool" &&
              p.state === "output-available" &&
              [
                "run_skill_script",
                "exec_command",
                "write_file",
                "edit_file",
                "create_document",
                "create_spreadsheet",
                "create_presentation",
              ].includes(String(p.toolName))
          );
          const announcesImminentBuild =
            /(?:saya\s+(?:buat(?:kan)?|susun(?:\s+ulang)?|kerjakan|rancang\s+ulang)\s+[^.!\n]{0,80}(?:sekarang|pdf|dokumen|poster|file|reportlab|python|node)|sekarang\s+saya\s+(?:buat|susun|kerjakan|gabungkan)|skill\s+(?:pdf|docx|xlsx|pptx)\s+sudah\s+aktif|mari\s+kita\s+(?:simpan|buat\s+file)|buatkan\s+file\s+html|simpan\s+dan\s+buat\s+file)/i.test(
              turnContent
            );
          const roleplayedFileCreation =
            !ranAnyCreationTool &&
            /(?:file\s+(?:yang\s+bisa\s+diunduh|terbaru)|berikut\s+file-?nya|posternya\s+sudah\s+jadi|ilustrasi\s+baru\s+sudah\s+terpasang|semua\s+(?:komponen\s+)?sudah\s+selesai\.\s*satu\s+pdf)/i.test(
              turnContent
            );

          const seemsUnfulfilledFilePromise =
            unfulfilledPromiseNudges < 2 &&
            (remainingToolRounds > 0 || remainingGraceRounds > 0) &&
            resolvedModel.supportsTools &&
            ((loadedDocSkill && !producedOfficeOrPdfDoc) ||
              (announcesImminentBuild && !producedOfficeOrPdfDoc && producedFilesSoFar.length === 0) ||
              (announcesImminentBuild && loadedDocSkill && !producedOfficeOrPdfDoc) ||
              roleplayedFileCreation);

          if (seemsUnfulfilledFilePromise && !forceFinalAnswer) {
            unfulfilledPromiseNudges += 1;
            stepIndex += 1;
            if (remainingToolRounds > 0) remainingToolRounds -= 1;
            else if (remainingGraceRounds > 0) remainingGraceRounds -= 1;

            currentMessages.push({
              role: "assistant",
              content: turnContent,
            });
            currentMessages.push({
              role: "user",
              content: loadedDocSkill || /pdf|docx|xlsx|pptx|poster|reportlab/i.test(turnContent)
                ? "[SYSTEM ENFORCEMENT: You announced or claimed that you are creating/updating a document or poster (or loaded a document skill), but you ended your turn without executing `run_skill_script` (or `generate_image`)! Never stop after announcing your plan and never simulate tool execution in text. Call `run_skill_script` (and `generate_image` if a poster is requested) NOW to actually generate the final deliverable file. If you build modular raw parts (`_part1.pdf`, `_part2.pdf`), merge them and delete the `_part*.pdf` files so the user only receives the 1 final document.]"
                : "Panggil tool `write_file`, `generate_image`, atau `run_skill_script` sekarang untuk membuat file lengkapnya.",
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
        if ((!lastTurnHadText || interruptedAfterTools) && hasSuccessfulToolResult(executedToolParts)) {
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

        // Store the turn (Redis → one Postgres transaction). Always billed, so the
        // request count moves even at $0.
        fillTurn("completed", null);
        await finishTurn(
          finalTurnTokens({
            completed: true,
            promptTokens,
            completionTokens,
            generatedChars: fullContent.length + fullReasoning.length,
            promptChars: estimatePromptChars,
          })
        );

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

        // A stopped / failed stream that produced output is still billed (estimated
        // where the provider never reported usage); an upstream rate limit is not.
        if (!isAbort && !fullContent.trim()) {
          // An empty failed reply would render as a blank bubble. The user gets a short
          // friendly line; the real trace is stored apart from it for the admin panel.
          fullContent = clientErrorText(streamErr);
        }
        fillTurn(finalStatus, errorCode, isUpstreamRateLimit, isAbort ? null : realErrorTrace(streamErr, requestId));
        await finishTurn(
          isUpstreamRateLimit
            ? null
            : finalTurnTokens({
                completed: false,
                promptTokens,
                completionTokens,
                generatedChars: fullContent.length + fullReasoning.length,
                promptChars: estimatePromptChars,
              })
        ).catch((err) => console.error(`[TURN_STORE_ERROR] [${requestId}]`, err));

        if (isAbort) {
          writer.write({
            type: "abort",
            reason: "Client stopped generation",
          });
          writer.setOutcome({ status: "aborted" });
        } else {
          // The stream error is the only text the client gets; the trace never leaves the server
          writer.write({
            type: "error",
            errorText: `${clientErrorText(streamErr)}\n${CLIENT_ERROR_REQUEST_ID_PREFIX}${requestId}`,
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

/**
 * Marks the request id inside the stream error text. The client splits it back off and shows
 * it on the error card; the stored message keeps only the friendly line.
 */
export const CLIENT_ERROR_REQUEST_ID_PREFIX = "request-id: ";

/** Short, safe line shown in the chat bubble. Never includes a stack, path, or upstream body. */
function clientErrorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof GatewayError && err.errorClass === "rate_limited") {
    return "Batas penggunaan model ini sudah tercapai. Coba lagi nanti.";
  }
  return "Maaf, terjadi kendala saat menjawab. Silakan coba lagi.";
}

/** The real failure, kept on the message row for the admin error search. */
function realErrorTrace(err: unknown, requestId: string): string {
  const lines = [`requestId: ${requestId}`];
  if (err instanceof GatewayError) {
    lines.push(`class: ${err.errorClass}`, err.httpStatus ? `http: ${err.httpStatus}` : "");
  } else if (err instanceof ApiError) {
    lines.push(`code: ${err.code}`, `http: ${err.status}`);
  }
  if (err instanceof Error) {
    lines.push(err.message);
    if (err.stack) lines.push(err.stack);
  } else {
    lines.push(String(err));
  }
  return lines.filter(Boolean).join("\n").slice(0, 8000);
}
