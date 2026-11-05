import { randomUUID } from "node:crypto";
import { CODEX_CLI_VERSION } from "@/lib/oauth/constants/openai";

/**
 * ChatGPT Codex image generation: a Responses API request whose only tool is
 * `image_generation`. The model id the admin picks (`gpt-5.6-luna-image`) is
 * the chat model plus an `-image` suffix; the suffix is stripped for the
 * request and the image comes back base64 inside the SSE stream.
 * Mirrors the working request in 9router (open-sse/handlers/imageProviders/codex.js).
 */

const CODEX_RESPONSES_PATH = "/responses";

/** Dedicated image models that ride on a main chat model's image tool. */
const CODEX_TOOL_IMAGE_MODELS = new Set([
  "gpt-image-1.5",
  "gpt-image-2",
  "gpt-image-2.5",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
]);
const CODEX_IMAGES_MAIN_MODEL = "gpt-5.6-sol";

const MIME_BY_FORMAT: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  webp: "image/webp",
};

export interface CodexImageRequest {
  prompt: string;
  /** Upstream model key, e.g. `gpt-5.6-luna-image` */
  modelKey: string;
  size?: string;
  outputFormat?: string;
  background?: "transparent" | "opaque" | "auto";
  quality?: string;
  signal?: AbortSignal;
}

export interface CodexImageResult {
  buffer: Buffer;
  mimeType: string;
}

/** `gpt-5.6-luna-image` -> chat model `gpt-5.6-luna`; dedicated tool models stay as they are. */
export function resolveCodexImageModel(modelKey: string): { responsesModel: string; toolModel: string | null } {
  if (CODEX_TOOL_IMAGE_MODELS.has(modelKey)) {
    return { responsesModel: CODEX_IMAGES_MAIN_MODEL, toolModel: modelKey };
  }
  const responsesModel = modelKey.endsWith("-image") ? modelKey.slice(0, -"-image".length) : modelKey;
  return { responsesModel, toolModel: null };
}

/** The exact body Codex accepts for one image. */
export function buildCodexImageBody(req: CodexImageRequest): Record<string, unknown> {
  const { responsesModel, toolModel } = resolveCodexImageModel(req.modelKey);
  const format = (req.outputFormat ?? "png").toLowerCase();
  const imgTool: Record<string, unknown> = { type: "image_generation", output_format: format };
  if (toolModel) {
    imgTool.model = toolModel;
    imgTool.action = "generate";
  }
  if (req.size) imgTool.size = req.size;
  if (req.quality) imgTool.quality = req.quality;
  if (req.background) imgTool.background = req.background;

  return {
    model: responsesModel,
    instructions: "",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: req.prompt }] }],
    tools: [imgTool],
    tool_choice: toolModel ? { type: "image_generation" } : "auto",
    parallel_tool_calls: false,
    prompt_cache_key: randomUUID(),
    stream: true,
    store: false,
    ...(toolModel ? { reasoning: { effort: "medium", summary: "auto" } } : {}),
  };
}

/** Identity headers the Codex backend checks on every request. */
export function buildCodexImageHeaders(authHeaders: Record<string, string>, accessToken: string): Record<string, string> {
  const requestId = randomUUID();
  return {
    ...authHeaders,
    accept: "text/event-stream, application/json",
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    originator: "codex_cli_rs",
    session_id: requestId,
    "user-agent": `codex_cli_rs/${CODEX_CLI_VERSION}`,
    version: CODEX_CLI_VERSION,
    "x-client-request-id": requestId,
  };
}

export function codexResponsesUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${CODEX_RESPONSES_PATH}`;
}

export interface CodexImageStream {
  image: CodexImageResult | null;
  /** Error the stream reported (`error` / `response.failed`) */
  error: string | null;
  /** Text the model answered instead of drawing (e.g. a refusal) */
  text: string;
}

function errorMessageOf(record: Record<string, unknown>): string | null {
  const response = (record.response ?? {}) as Record<string, unknown>;
  const err = (record.error ?? response.error ?? null) as Record<string, unknown> | string | null;
  if (typeof err === "string") return err;
  if (err && typeof err.message === "string") return err.message;
  if (typeof record.message === "string") return record.message;
  return null;
}

/** Reads the finished image out of the SSE stream (`response.output_item.done`). */
export function parseCodexImageStream(sseBody: string): CodexImageStream {
  let imageB64: string | null = null;
  let outputFormat = "png";
  let error: string | null = null;
  let text = "";
  for (const block of sseBody.split(/\n\n/)) {
    let eventName = "";
    let dataStr = "";
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
    }
    if (!dataStr) continue;
    let data: unknown;
    try {
      data = JSON.parse(dataStr);
    } catch {
      continue;
    }
    const record = (data ?? {}) as Record<string, unknown>;
    if (eventName === "response.output_item.done") {
      const item = (record.item ?? {}) as Record<string, unknown>;
      if (item.type === "image_generation_call" && typeof item.result === "string" && item.result) {
        imageB64 = item.result;
        if (typeof item.output_format === "string") outputFormat = item.output_format;
      }
    } else if (eventName === "response.output_text.delta" && typeof record.delta === "string") {
      text += record.delta;
    } else if (eventName === "error" || eventName === "response.failed" || eventName === "response.incomplete") {
      error = errorMessageOf(record) ?? eventName;
    }
  }
  const image = imageB64
    ? { buffer: Buffer.from(imageB64, "base64"), mimeType: MIME_BY_FORMAT[outputFormat] ?? "image/png" }
    : null;
  return { image, error, text: text.trim() };
}

/**
 * Codex size closest to the requested aspect ratio (post-processing crops to the exact one).
 * The GPT-5.6 chat models may ignore it and pick their own framing, so the adapter also
 * states the ratio in the prompt.
 */
export function codexSizeFor(aspectRatio?: string, resolution?: string): string | undefined {
  const match = resolution?.trim().match(/^(\d{2,4})[xX*](\d{2,4})$/);
  const ratio = match ? Number(match[1]) / Number(match[2]) : aspectRatioValue(aspectRatio);
  if (ratio === null) return undefined;
  if (ratio > 1.15) return "1536x1024";
  if (ratio < 0.87) return "1024x1536";
  return "1024x1024";
}

function aspectRatioValue(aspectRatio?: string): number | null {
  const match = aspectRatio?.match(/^(\d+):(\d+)$/);
  return match ? Number(match[1]) / Number(match[2]) : null;
}
