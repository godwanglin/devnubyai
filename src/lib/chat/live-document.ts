import { getExtensionLabel, getMimeTypeForFilename, isImageMimeType } from "@/lib/files/policy";
import type { SessionFileItem, ToolActivity } from "@/types";
import { isHelperSkillArtifactName, isScratchFileName } from "./turn-recovery";

/**
 * Live document preview: while the AI builds a PDF / Word / Excel / PowerPoint (or HTML,
 * Markdown) file, the files panel opens on its own and follows the build — the code as it
 * streams in, every version the running script writes (`data-live-document`), then the
 * final file once the tool returns.
 */

export type LiveDocumentPhase = "writing" | "running" | "rendering" | "error";

export interface LiveDocumentState {
  toolCallId: string;
  toolName: string;
  phase: LiveDocumentPhase;
  /** Best guess of the file being built, refined as the input streams in */
  filename: string;
  /** Code / content streaming in (tail shown while nothing is rendered yet) */
  source: string;
  /** The call's (partial) input, for the page-shaped draft */
  input: unknown;
  /** Latest version written by the running script, served from the workspace */
  preview: SessionFileItem | null;
  /** The preview is this call's own output (not the previous version kept during a revision) */
  previewIsLive: boolean;
  error?: string;
}

/** Payload of the transient `data-live-document` stream part (see generate.ts). */
export interface LiveDocumentEvent {
  toolCallId: string;
  path: string;
  sizeBytes: number;
  version: number;
  url: string;
}

const DOCUMENT_EXT_RE = /\.(?:pdf|docx|xlsx|pptx|html?|md|csv|svg)$/i;
const BINARY_DOCUMENT_EXT_RE = /\.(?:pdf|docx|dotx|xlsx|xlsm|pptx|potx)$/i;
const DOCUMENT_SKILLS = new Set(["pdf", "docx", "xlsx", "pptx"]);
const CREATE_TOOLS = new Set(["create_document", "create_spreadsheet", "create_presentation"]);
const WRITE_TOOLS = new Set(["write_file", "edit_file"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Output file names written in a script, in order (`'Laporan_Akhir.pdf'`, `"deck.pptx"`). */
function documentLiteralsIn(code: string): string[] {
  const names: string[] = [];
  const re = /["'`]([^"'`\n\r]{1,160}\.(?:pdf|docx|xlsx|pptx|html?|md|csv))["'`]/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    const name = match[1].replace(/\\/g, "/").split("/").pop() ?? "";
    if (name && !isScratchFileName(name)) names.push(name);
  }
  return names;
}

/** Whether this tool call builds a document worth following live. */
export function isDocumentBuildCall(tool: Pick<ToolActivity, "name" | "input">): boolean {
  const input = record(tool.input);
  if (CREATE_TOOLS.has(tool.name)) return true;
  if (WRITE_TOOLS.has(tool.name)) {
    const filename = String(input.filename ?? input.path ?? "");
    return DOCUMENT_EXT_RE.test(filename) && !isScratchFileName(filename);
  }
  if (tool.name === "run_skill_script") {
    const code = typeof input.code === "string" ? input.code : "";
    // Helper scripts (`check_fillable_fields.py`) only inspect; inline code builds
    if (!code) return false;
    return DOCUMENT_SKILLS.has(String(input.skill ?? "")) || documentLiteralsIn(code).length > 0;
  }
  if (tool.name === "exec_command") {
    return documentLiteralsIn(String(input.command ?? "")).length > 0;
  }
  return false;
}

/** Name of the file the call is building, as far as the streamed input tells. */
export function guessDocumentName(tool: Pick<ToolActivity, "name" | "input">): string {
  const input = record(tool.input);
  const direct = String(input.filename ?? input.path ?? "").trim();
  if (direct) return direct.replace(/\\/g, "/").split("/").pop() ?? direct;
  const code = String(input.code ?? input.command ?? "");
  const literals = documentLiteralsIn(code);
  // The deliverable is usually the last document the script saves
  return literals[literals.length - 1] ?? "";
}

/** The code or content streaming into the call, for the view shown before a render exists. */
export function streamingSourceOf(tool: Pick<ToolActivity, "input">): string {
  const input = record(tool.input);
  for (const key of ["code", "content", "command", "markdown", "html"]) {
    if (typeof input[key] === "string") return input[key] as string;
  }
  return "";
}

export interface LiveDocumentStep {
  /** The live view to show next (null: none) */
  live: LiveDocumentState | null;
  /** Set when the followed build finished with a deliverable: open it in the panel */
  final?: SessionFileItem;
}

/**
 * Advances the live view from the open chat's messages (pure; called while rendering).
 * Returns null when nothing changes.
 */
export function stepLiveDocument(params: {
  current: LiveDocumentState | null;
  messages: ReadonlyArray<{ id: string; role: string; toolCalls?: ToolActivity[] }>;
  streamingId: string | null;
  chatId: string;
  dismissed: ReadonlySet<string>;
  lastFinal: SessionFileItem | null;
}): LiveDocumentStep | null {
  const { current, messages, streamingId, chatId, dismissed, lastFinal } = params;
  let lastAssistant: (typeof messages)[number] | undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "assistant") {
      lastAssistant = messages[i];
      break;
    }
  }
  const tools = lastAssistant?.toolCalls ?? [];

  // 1. The followed call has finished (or failed)
  if (current) {
    const tracked = tools.find((tool) => tool.id === current.toolCallId);
    if (tracked?.state === "completed") {
      const final = finalDocumentOf(tracked, chatId, current.filename);
      return { live: null, final: final ?? undefined };
    }
    // Once marked failed it stays on screen until the next build (the retry) replaces it
    if (tracked?.state === "error" && current.phase !== "error") {
      return { live: { ...current, phase: "error", error: tracked.error || undefined } };
    }
  }

  // 2. The latest document build of the reply still being generated
  if (!streamingId || lastAssistant?.id !== streamingId) return null;
  let build: ToolActivity | null = null;
  for (const tool of tools) {
    if ((tool.state === "streaming" || tool.state === "running") && isDocumentBuildCall(tool)) build = tool;
  }
  if (!build || dismissed.has(build.id)) return null;

  const filename = guessDocumentName(build) || current?.filename || "";
  const source = streamingSourceOf(build);
  const phase: LiveDocumentPhase = build.state === "streaming" ? "writing" : "running";

  if (current?.toolCallId !== build.id) {
    // A revision of the last document keeps showing it until the new version lands
    const previous =
      current?.preview ??
      (lastFinal && filename && lastFinal.displayName.toLowerCase() === filename.toLowerCase() ? lastFinal : null);
    return {
      live: {
        toolCallId: build.id,
        toolName: build.name,
        phase,
        filename,
        source,
        input: build.input,
        preview: previous,
        previewIsLive: false,
      },
    };
  }

  const nextPhase = current.phase === "rendering" ? "rendering" : phase;
  if (current.filename === filename && current.source === source && current.phase === nextPhase && current.input === build.input) return null;
  return { live: { ...current, filename, source, input: build.input, phase: nextPhase } };
}

/** A previewable file item for a workspace version announced by the server. */
export function livePreviewItem(event: LiveDocumentEvent): SessionFileItem {
  const name = event.path.split("/").pop() || event.path;
  const mimeType = getMimeTypeForFilename(name);
  return {
    id: `live:${event.toolCallId}:${event.path}`,
    filename: name,
    displayName: name,
    extension: getExtensionLabel(name),
    mimeType,
    sizeBytes: event.sizeBytes,
    source: "live",
    isImage: isImageMimeType(mimeType),
    url: event.url,
    createdAt: new Date(event.version).toISOString(),
  };
}

/**
 * The deliverable a finished call produced, as a panel item: the file the call reported,
 * preferring the name the script was seen writing; scratch and helper files never count.
 */
export function finalDocumentOf(
  tool: Pick<ToolActivity, "name" | "input" | "output">,
  chatId: string,
  preferredName: string
): SessionFileItem | null {
  const output = record(tool.output);
  const data = record(output.data ?? output);
  const candidates: Record<string, unknown>[] = Array.isArray(data.generatedFiles)
    ? (data.generatedFiles as unknown[]).map(record)
    : data.id || data.url
      ? [data]
      : [];

  const names = candidates.map((c) => String(c.displayName || c.filename || ""));
  const documents = candidates.filter((c, i) => {
    const name = names[i];
    return (
      name &&
      DOCUMENT_EXT_RE.test(name) &&
      !isHelperSkillArtifactName(name, names)
    );
  });
  if (documents.length === 0) return null;

  const preferred = preferredName.toLowerCase();
  const pick =
    documents.find((c) => String(c.displayName || c.filename || "").toLowerCase() === preferred) ??
    // Binary deliverables (PDF/DOCX/...) over side outputs like a CSV export
    documents.filter((c) => BINARY_DOCUMENT_EXT_RE.test(String(c.displayName || c.filename || ""))).pop() ??
    documents[documents.length - 1];

  const filename = String(pick.filename || pick.displayName || "");
  const displayName = String(pick.displayName || filename);
  const rawUrl = typeof pick.url === "string" ? pick.url : "";
  const url = rawUrl.startsWith("/api/v1/")
    ? rawUrl
    : typeof pick.id === "string"
      ? `/api/v1/chats/${chatId}/files/${pick.id}`
      : "";
  if (!url) return null;
  const mimeType = String(pick.mimeType || getMimeTypeForFilename(displayName));
  return {
    id: String(pick.id || url),
    filename,
    displayName,
    extension: getExtensionLabel(displayName),
    mimeType,
    sizeBytes: typeof pick.sizeBytes === "number" ? pick.sizeBytes : 0,
    source: "tool",
    isImage: isImageMimeType(mimeType),
    url,
    createdAt: new Date().toISOString(),
  };
}
