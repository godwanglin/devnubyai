import crypto from "node:crypto";
import type {
  ChatMessageInput,
  DecryptedGatewayConfig,
  FinishReason,
  GatewayExecutionRequest,
  GatewayStreamEvent,
  MultimodalContentPart,
} from "../types";
import type { SseRecord } from "../sse";
import { streamFromGateway } from "./http";
import { cleanJSONSchemaForAntigravity, sanitizeGeminiFunctionName } from "./antigravity-schema";
import { antigravityThinkingConfig, resolveAntigravityModel } from "./antigravity-model-map";
import {
  ANTIGRAVITY_PROJECT_HEADER,
  ANTIGRAVITY_SESSION_HEADER,
  ANTIGRAVITY_STREAM_URL,
  ANTIGRAVITY_USER_AGENT,
  DEFAULT_THINKING_AG_SIGNATURE,
  buildIdeRequestId,
  toNumericSessionId,
} from "@/lib/oauth/constants/antigravity";

/**
 * Google Cloud Code Assist (Antigravity) wire adapter:
 * `POST daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse`
 * with the IDE request envelope `{ project, model, userAgent, requestId, request }`.
 */

const MAX_OUTPUT_TOKENS = 64000;

type GeminiPart = Record<string, unknown>;
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

/** Gemini 4 removed sampling params; sending them fails the request. */
export function isGemini4Model(model: string): boolean {
  return /(?:^|\/)gemini-4(?:$|[-.])/i.test(model);
}

function textOf(content: ChatMessageInput["content"]): string {
  if (typeof content === "string") return content;
  return content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
}

function convertUserPart(part: MultimodalContentPart): GeminiPart | null {
  if (part.type === "text") return part.text ? { text: part.text } : null;
  const url = part.image_url?.url;
  if (!url) return null;
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    if (comma === -1) return null;
    const mimeType = url.substring(5, comma).split(";")[0] || "image/jpeg";
    return { inlineData: { mimeType, data: url.substring(comma + 1) } };
  }
  return { fileData: { fileUri: url, mimeType: "image/*" } };
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return { result: parsed };
  } catch {
    return { result: raw };
  }
}

/** Gemini 4 rejects a merged user turn whose last part is not a functionResponse. */
function functionResponsesLast(parts: GeminiPart[]): GeminiPart[] {
  const responses = parts.filter((p) => p.functionResponse);
  if (responses.length === 0) return parts;
  return [...parts.filter((p) => !p.functionResponse), ...responses];
}

/** OpenAI-style history -> Gemini `contents` + `systemInstruction` text. */
export function toGeminiContents(messages: ChatMessageInput[]): { contents: GeminiContent[]; systemText: string } {
  const systemTexts: string[] = [];
  const raw: GeminiContent[] = [];
  // functionResponse.name must match its call; devnuby tool messages carry only the call id
  const callNames = new Map<string, string>();
  for (const m of messages) for (const tc of m.toolCalls ?? []) callNames.set(tc.id, tc.name);

  for (const m of messages) {
    if (m.role === "system") {
      const text = textOf(m.content).trim();
      if (text) systemTexts.push(text);
      continue;
    }

    if (m.role === "user") {
      const parts =
        typeof m.content === "string"
          ? m.content.trim()
            ? [{ text: m.content }]
            : []
          : m.content.map(convertUserPart).filter((p): p is GeminiPart => p !== null);
      if (parts.length) raw.push({ role: "user", parts });
      continue;
    }

    if (m.role === "assistant") {
      const parts: GeminiPart[] = [];
      const text = textOf(m.content);
      if (text.trim()) parts.push({ text });
      (m.toolCalls ?? []).forEach((tc, idx) => {
        parts.push({
          functionCall: { id: tc.id, name: sanitizeGeminiFunctionName(tc.name), args: parseJsonObject(tc.arguments) },
          // History does not keep Google's signature; the first call of a turn needs one (400 otherwise)
          ...(idx === 0 ? { thoughtSignature: DEFAULT_THINKING_AG_SIGNATURE } : {}),
        });
      });
      if (parts.length) raw.push({ role: "model", parts });
      continue;
    }

    // tool result
    const callId = m.toolCallId ?? "";
    const name = m.name || callNames.get(callId) || "tool";
    raw.push({
      role: "user",
      parts: [
        {
          functionResponse: {
            ...(callId ? { id: callId } : {}),
            name: sanitizeGeminiFunctionName(name),
            response: { result: parseJsonObject(textOf(m.content)) },
          },
        },
      ],
    });
  }

  // Merge same-role neighbours; history must start and end on a user turn
  const contents: GeminiContent[] = [];
  for (const c of raw) {
    const last = contents[contents.length - 1];
    if (last && last.role === c.role) last.parts = functionResponsesLast([...last.parts, ...c.parts]);
    else contents.push({ role: c.role, parts: [...c.parts] });
  }
  if (contents.length === 0 || contents[0].role !== "user") {
    contents.unshift({ role: "user", parts: [{ text: "..." }] });
  }
  const tail = contents[contents.length - 1];
  if (tail.role === "model") {
    const calls = tail.parts.filter((p) => p.functionCall) as Array<{ functionCall: { id?: string; name?: string } }>;
    contents.push({
      role: "user",
      parts: calls.length
        ? calls.map(({ functionCall: fc }) => ({
            functionResponse: { ...(fc.id ? { id: fc.id } : {}), name: fc.name || "tool", response: { result: "Continue." } },
          }))
        : [{ text: "Continue." }],
    });
  }

  return { contents, systemText: systemTexts.join("\n\n") };
}

function firstUserText(messages: ChatMessageInput[]): string {
  const first = messages.find((m) => m.role === "user");
  return first ? textOf(first.content).slice(0, 2000) : "";
}

/** Builds the Cloud Code Assist IDE envelope. `requestType` is deliberately omitted (false 429 otherwise). */
export function buildAntigravityEnvelope(
  request: GatewayExecutionRequest,
  projectId: string,
  sessionSeed?: string
): Record<string, unknown> {
  const { contents, systemText } = toGeminiContents(request.messages);
  const resolved = resolveAntigravityModel(request.model);
  const thinking = antigravityThinkingConfig(resolved, request.reasoningEffort);

  let maxOutputTokens = Math.min(request.maxTokens ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
  if (thinking) maxOutputTokens = Math.min(Math.max(maxOutputTokens, thinking.minOutputTokens), MAX_OUTPUT_TOKENS);

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens,
    ...(thinking ? { thinkingConfig: thinking.thinkingConfig } : {}),
  };
  if (!isGemini4Model(resolved.upstreamModel)) {
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.topP !== undefined) generationConfig.topP = request.topP;
  }

  const declarations = new Map<string, Record<string, unknown>>();
  for (const tool of request.tools ?? []) {
    const name = sanitizeGeminiFunctionName(tool.name);
    if (declarations.has(name)) continue;
    declarations.set(name, {
      name,
      description: tool.description || "",
      parameters: cleanJSONSchemaForAntigravity(tool.parameters),
    });
  }
  const hasTools = declarations.size > 0 && request.toolChoice !== "none";

  // Same conversation -> same session id, so Google can reuse its prompt cache
  const sessionId = toNumericSessionId(`antigravity:${sessionSeed ?? ""}:${firstUserText(request.messages)}`);

  return {
    project: projectId,
    model: resolved.upstreamModel,
    userAgent: "antigravity",
    requestId: buildIdeRequestId(Math.max(1, contents.length * 2 - 1)),
    request: {
      sessionId,
      contents,
      generationConfig,
      ...(systemText ? { systemInstruction: { role: "user", parts: [{ text: systemText }] } } : {}),
      ...(hasTools
        ? {
            tools: [{ functionDeclarations: [...declarations.values()] }],
            toolConfig: { functionCallingConfig: { mode: "VALIDATED" } },
          }
        : {}),
    },
  };
}

function mapFinishReason(raw: unknown, sawToolCall: boolean): FinishReason {
  if (raw === "STOP") return sawToolCall ? "tool_calls" : "stop";
  if (raw === "MAX_TOKENS") return "length";
  if (raw === "SAFETY" || raw === "RECITATION" || raw === "PROHIBITED_CONTENT" || raw === "BLOCKLIST") {
    return "content_filter";
  }
  return sawToolCall ? "tool_calls" : "unknown";
}

/**
 * Stateful SSE parser: Gemini sends each functionCall whole (no fragments), so
 * calls get a running index; usage is emitted once, from the last metadata seen.
 */
export function createAntigravityParser(): (record: SseRecord) => GatewayStreamEvent[] {
  let toolIndex = 0;
  let finished = false;

  return (record) => {
    if (record.data === "[DONE]") return [];
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(record.data) as Record<string, unknown>;
    } catch {
      return [];
    }

    const response = (payload.response && typeof payload.response === "object" ? payload.response : payload) as Record<string, unknown>;
    const candidate = (Array.isArray(response.candidates) ? response.candidates[0] : null) as Record<string, unknown> | null;
    const events: GatewayStreamEvent[] = [];

    const parts = (candidate?.content as { parts?: unknown } | undefined)?.parts;
    for (const part of Array.isArray(parts) ? (parts as GeminiPart[]) : []) {
      if (typeof part.text === "string" && part.text) {
        events.push({ type: part.thought === true ? "reasoning" : "delta", text: part.text });
      }
      const fc = part.functionCall as { id?: string; name?: string; args?: unknown } | undefined;
      if (fc && typeof fc === "object") {
        events.push({
          type: "tool_call",
          callId: fc.id || `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
          index: toolIndex,
          name: fc.name || "unknown",
          argumentsDelta: JSON.stringify(fc.args ?? {}),
        });
        toolIndex += 1;
      }
    }

    const usage = (response.usageMetadata ?? payload.usageMetadata) as Record<string, unknown> | undefined;
    if (candidate?.finishReason && !finished) {
      finished = true;
      if (usage && typeof usage.promptTokenCount === "number") {
        const completion =
          (typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : 0) +
          (typeof usage.thoughtsTokenCount === "number" ? usage.thoughtsTokenCount : 0);
        events.push({
          type: "usage",
          promptTokens: usage.promptTokenCount,
          completionTokens: completion,
          totalTokens: typeof usage.totalTokenCount === "number" ? usage.totalTokenCount : usage.promptTokenCount + completion,
        });
      }
      events.push({ type: "finish", reason: mapFinishReason(candidate.finishReason, toolIndex > 0) });
    }

    return events;
  };
}

export function executeAntigravity(
  gateway: DecryptedGatewayConfig,
  request: GatewayExecutionRequest
): AsyncGenerator<GatewayStreamEvent> {
  // Internal routing hints set by oauth-dispatch; never forwarded to Google
  const {
    [ANTIGRAVITY_PROJECT_HEADER]: projectId,
    [ANTIGRAVITY_SESSION_HEADER]: sessionSeed,
    ...forwarded
  } = gateway.extraHeaders ?? {};
  for (const key of Object.keys(forwarded)) {
    const lower = key.toLowerCase();
    if (lower === "content-type" || lower === "accept" || lower === "authorization") delete forwarded[key];
  }

  const envelope = buildAntigravityEnvelope(request, projectId || "", sessionSeed);
  const url = new URL(ANTIGRAVITY_STREAM_URL);

  return streamFromGateway(
    {
      ...gateway,
      baseUrl: url.origin,
      extraHeaders: { ...forwarded, "User-Agent": ANTIGRAVITY_USER_AGENT },
    },
    `${url.pathname}${url.search}`,
    envelope,
    createAntigravityParser(),
    request.signal
  );
}
