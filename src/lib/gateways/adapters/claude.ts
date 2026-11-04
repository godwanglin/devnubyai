import crypto from "node:crypto";
import type {
  ChatMessageInput,
  DecryptedGatewayConfig,
  FinishReason,
  GatewayExecutionRequest,
  GatewayStreamEvent,
} from "../types";
import type { SseRecord } from "../sse";
import { streamFromGateway } from "./http";
import { sanitizeParametersSchema } from "./schema";
import { applyClaudeCodeCloaking, extractClaudeCliVersion } from "./claude-cloaking";

function mapFinishReason(value: unknown): FinishReason {
  if (value === "end_turn" || value === "stop_sequence") return "stop";
  if (value === "max_tokens") return "length";
  if (value === "tool_use") return "tool_calls";
  return "unknown";
}

export function isAdaptiveThinkingModel(model: string): boolean {
  return /claude-(?:sonnet|opus|haiku|fable)-5|claude-opus-4-[78]/i.test(model);
}

export function isBudgetThinkingModel(model: string): boolean {
  return /claude-3-7|claude-(?:sonnet|opus)-4-[56]/i.test(model);
}

function resolveThinkingBudget(effort?: string, maxTokens = 8192): number {
  switch (effort) {
    case "low":
      return Math.min(2048, Math.max(1024, Math.floor(maxTokens * 0.25)));
    case "medium":
      return Math.min(4096, Math.max(2048, Math.floor(maxTokens * 0.5)));
    case "high":
    case "xhigh":
      return Math.min(16384, Math.max(4096, Math.floor(maxTokens * 0.75)));
    default:
      return 2048;
  }
}

/** Converts internal ChatMessageInput into Anthropic Messages API format */
function buildClaudeBody(request: GatewayExecutionRequest): Record<string, unknown> {
  const systemParts: string[] = [];
  const normalizedMessages: Array<{ role: "user" | "assistant"; content: unknown[] }> = [];

  for (const m of request.messages) {
    if (m.role === "system") {
      if (typeof m.content === "string" && m.content.trim()) {
        systemParts.push(m.content.trim());
      }
      continue;
    }

    const blocks: unknown[] = [];

    // Tool response turn (in Anthropic, this is sent as a user turn with tool_result block)
    if (m.role === "tool" || m.toolCallId) {
      blocks.push({
        type: "tool_result",
        tool_use_id: m.toolCallId || "call_unknown",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      });
    } else if (m.toolCalls?.length) {
      // Assistant tool calls
      if (typeof m.content === "string" && m.content.trim()) {
        blocks.push({ type: "text", text: m.content });
      }
      for (const call of m.toolCalls) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(call.arguments);
        } catch {
          input = { raw: call.arguments };
        }
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input,
        });
      }
    } else if (typeof m.content === "string") {
      if (m.content.length > 0) {
        blocks.push({ type: "text", text: m.content });
      }
    } else if (Array.isArray(m.content)) {
      // Multimodal parts
      for (const part of m.content) {
        if (part.type === "text" && part.text) {
          blocks.push({ type: "text", text: part.text });
        } else if (part.type === "image_url" && part.image_url?.url) {
          const url = part.image_url.url;
          if (url.startsWith("data:")) {
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              blocks.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: match[1],
                  data: match[2],
                },
              });
            }
          }
        }
      }
    }

    if (blocks.length === 0) continue;

    const role = m.role === "assistant" ? "assistant" : "user";
    const prev = normalizedMessages[normalizedMessages.length - 1];

    // Anthropic requires strictly alternating turns; merge back-to-back same-role messages
    if (prev && prev.role === role) {
      prev.content.push(...blocks);
    } else {
      normalizedMessages.push({ role, content: blocks });
    }
  }

  // Anthropic requires the first message to be from the 'user'
  if (normalizedMessages.length === 0 || normalizedMessages[0].role !== "user") {
    normalizedMessages.unshift({ role: "user", content: [{ type: "text", text: "Hello" }] });
  }

  let maxTokens = request.maxTokens ?? 32000;
  const effort = request.reasoningEffort;
  const isAdaptive = isAdaptiveThinkingModel(request.model);
  const isBudget = isBudgetThinkingModel(request.model);
  const requestedReasoning = effort && effort !== "off";

  const body: Record<string, unknown> = {
    model: request.model,
    messages: normalizedMessages,
    max_tokens: maxTokens,
    stream: true,
  };

  if (systemParts.length > 0) {
    body.system = systemParts.join("\n\n");
  }

  let thinkingActive = false;

  // Claude 5/5.5 models use adaptive thinking with output_config.effort
  if (isAdaptive) {
    body.thinking = { type: "adaptive" };
    if (requestedReasoning) {
      const mappedEffort = effort === "xhigh" ? "high" : effort;
      body.output_config = { effort: mappedEffort };
    }
    thinkingActive = true;
  } else if (requestedReasoning || isBudget) {
    // Claude 3.7 / 4.x budget-based thinking
    if (requestedReasoning) {
      const budget = resolveThinkingBudget(effort, maxTokens);
      body.thinking = { type: "enabled", budget_tokens: budget };
      if (maxTokens < budget + 16384) {
        maxTokens = budget + 16384;
        body.max_tokens = maxTokens;
      }
      thinkingActive = true;
    }
  }

  // Temperature and top_p must be omitted when thinking is enabled
  if (!thinkingActive) {
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.topP !== undefined) {
      body.top_p = request.topP;
    }
  }

  if (request.tools?.length) {
    body.tools = request.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: sanitizeParametersSchema(t.parameters as unknown as Record<string, unknown>),
    }));
  }

  // Strip parameters that Anthropic rejects
  const cleanOverrides = { ...(request.paramOverrides ?? {}) };
  delete cleanOverrides.reasoning_effort;
  delete cleanOverrides.reasoningEffort;
  delete cleanOverrides.thinking_budget;

  return { ...body, ...cleanOverrides, model: request.model };
}

/** Parses Anthropic SSE event records into GatewayStreamEvent */
export function createClaudeParser(): (record: SseRecord) => GatewayStreamEvent[] {
  let promptTokens = 0;
  let completionTokens = 0;
  const toolCallMap = new Map<number, { id: string; name: string }>();

  return (record: SseRecord): GatewayStreamEvent[] => {
    if (!record.data || record.data === "[DONE]") return [];

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(record.data);
    } catch {
      return [];
    }

    const type = (record.event || payload.type) as string;
    const events: GatewayStreamEvent[] = [];

    if (type === "message_start") {
      const msg = payload.message as Record<string, unknown> | undefined;
      const usage = msg?.usage as Record<string, unknown> | undefined;
      if (typeof usage?.input_tokens === "number") {
        promptTokens = usage.input_tokens;
        events.push({
          type: "usage",
          promptTokens,
          completionTokens,
        });
      }
    } else if (type === "content_block_start") {
      const block = payload.content_block as Record<string, unknown> | undefined;
      const index = typeof payload.index === "number" ? payload.index : 0;
      if (block?.type === "tool_use") {
        const id = String(block.id || `call_${index}`);
        const name = String(block.name || "");
        toolCallMap.set(index, { id, name });
        events.push({
          type: "tool_call",
          callId: id,
          index,
          name,
          argumentsDelta: "",
        });
      }
    } else if (type === "content_block_delta") {
      const delta = payload.delta as Record<string, unknown> | undefined;
      const index = typeof payload.index === "number" ? payload.index : 0;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        events.push({ type: "delta", text: delta.text });
      } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        events.push({ type: "reasoning", text: delta.thinking });
      } else if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
        const tool = toolCallMap.get(index);
        events.push({
          type: "tool_call",
          callId: tool?.id || `call_${index}`,
          index,
          name: tool?.name || "",
          argumentsDelta: delta.partial_json,
        });
      }
    } else if (type === "message_delta") {
      const delta = payload.delta as Record<string, unknown> | undefined;
      const usage = payload.usage as Record<string, unknown> | undefined;

      if (typeof usage?.output_tokens === "number") {
        completionTokens = usage.output_tokens;
        events.push({
          type: "usage",
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        });
      }

      if (delta?.stop_reason) {
        events.push({
          type: "finish",
          reason: mapFinishReason(delta.stop_reason),
        });
      }
    } else if (type === "message_stop") {
      // Stream finished
    }

    return events;
  };
}

/** Executes Anthropic Messages API streaming call */
export function executeClaude(
  gateway: DecryptedGatewayConfig,
  request: GatewayExecutionRequest
): AsyncGenerator<GatewayStreamEvent> {
  const rawBody = buildClaudeBody(request);
  const sessionId =
    (typeof gateway.extraHeaders?.["x-claude-code-session-id"] === "string" &&
      gateway.extraHeaders["x-claude-code-session-id"]) ||
    crypto.randomUUID();
  const userAgent =
    typeof gateway.extraHeaders?.["User-Agent"] === "string"
      ? gateway.extraHeaders["User-Agent"]
      : undefined;
  const version = extractClaudeCliVersion(userAgent);
  const body = applyClaudeCodeCloaking(rawBody, gateway.apiKey, sessionId, version);
  const parser = createClaudeParser();
  return streamFromGateway(gateway, "/messages?beta=true", body, parser, request.signal);
}
