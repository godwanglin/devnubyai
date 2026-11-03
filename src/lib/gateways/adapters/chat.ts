import type {
  DecryptedGatewayConfig,
  FinishReason,
  GatewayExecutionRequest,
  GatewayStreamEvent,
} from "../types";
import type { SseRecord } from "../sse";
import { streamFromGateway } from "./http";
import { sanitizeParametersSchema } from "./schema";

/** OpenAI-compatible `POST {base_url}/chat/completions`. */
function finishReason(value: unknown): FinishReason {
  if (value === "stop" || value === "length" || value === "tool_calls" || value === "content_filter") {
    return value;
  }
  return "unknown";
}

function buildBody(request: GatewayExecutionRequest): Record<string, unknown> {
  const normalizedMessages: Array<Record<string, unknown>> = [];
  for (const m of request.messages) {
    const hasToolCalls = Boolean(m.toolCalls?.length);
    const hasToolId = Boolean(m.toolCallId);
    const isString = typeof m.content === "string";
    const isEmptyString = isString && (m.content as string).trim().length === 0;

    // Empty turns with no tool linkage are rejected by strict providers
    if (isEmptyString && !hasToolCalls && !hasToolId) continue;

    // Back-to-back user turns (left when a reply between them failed) become one
    const prev = normalizedMessages[normalizedMessages.length - 1];
    if (m.role === "user" && prev?.role === "user" && isString && typeof prev.content === "string") {
      prev.content = `${prev.content}\n\n${m.content}`;
      continue;
    }

    // An assistant turn that only calls tools carries `content: null`, not ""
    const content = hasToolCalls && isEmptyString ? null : m.content;

    normalizedMessages.push({
      role: m.role,
      content,
      ...(m.name ? { name: m.name } : {}),
      ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      ...(hasToolCalls
        ? {
            tool_calls: m.toolCalls!.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
    });
  }

  const body: Record<string, unknown> = {
    model: request.model,
    messages: normalizedMessages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.topP !== undefined) body.top_p = request.topP;
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  if (request.reasoningEffort !== undefined) {
    body.reasoning_effort = request.reasoningEffort;
  }
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: sanitizeParametersSchema(tool.parameters as unknown as Record<string, unknown>),
      },
    }));
    if (request.toolChoice !== undefined) {
      body.tool_choice = request.toolChoice;
    }
  }
  return { ...body, ...(request.paramOverrides ?? {}), model: request.model };
}

function parseRecord(record: SseRecord): GatewayStreamEvent[] {
  if (record.data === "[DONE]") return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped upstream JSON, every field is guarded below
  let payload: any;
  try {
    payload = JSON.parse(record.data);
  } catch {
    return [];
  }

  const events: GatewayStreamEvent[] = [];
  const choice = payload?.choices?.[0];
  const delta = choice?.delta;
  if (typeof delta?.reasoning_content === "string" && delta.reasoning_content) {
    events.push({ type: "reasoning", text: delta.reasoning_content });
  }
  if (typeof delta?.content === "string" && delta.content) {
    events.push({ type: "delta", text: delta.content });
  }
  for (const call of Array.isArray(delta?.tool_calls) ? delta.tool_calls : []) {
    events.push({
      type: "tool_call",
      callId: typeof call?.id === "string" ? call.id : "",
      index: typeof call?.index === "number" ? call.index : undefined,
      name: call?.function?.name ?? "",
      argumentsDelta: call?.function?.arguments ?? "",
    });
  }
  const usage = payload?.usage;
  if (usage && typeof usage.prompt_tokens === "number") {
    events.push({
      type: "usage",
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens,
    });
  }
  if (choice?.finish_reason) {
    events.push({ type: "finish", reason: finishReason(choice.finish_reason) });
  }
  return events;
}

export function executeChat(
  gateway: DecryptedGatewayConfig,
  request: GatewayExecutionRequest
): AsyncGenerator<GatewayStreamEvent> {
  return streamFromGateway(gateway, "/chat/completions", buildBody(request), parseRecord, request.signal);
}
