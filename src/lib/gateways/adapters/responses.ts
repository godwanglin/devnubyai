import type {
  DecryptedGatewayConfig,
  GatewayExecutionRequest,
  GatewayStreamEvent,
} from "../types";
import type { SseRecord } from "../sse";
import { streamFromGateway } from "./http";

/** OpenAI Responses API `POST {base_url}/responses`. */
function buildBody(request: GatewayExecutionRequest): Record<string, unknown> {
  const system = request.messages.filter((m) => m.role === "system").map((m) => m.content);
  const body: Record<string, unknown> = {
    model: request.model,
    input: request.messages
      .filter((m) => m.role !== "system")
      .flatMap((m) => {
        if (m.role === "tool") {
          return [{ type: "function_call_output", call_id: m.toolCallId ?? "", output: m.content }];
        }
        const items: Array<Record<string, unknown>> = [];
        if (m.content) {
          items.push({ role: m.role, content: m.content });
        }
        if (m.toolCalls?.length) {
          for (const call of m.toolCalls) {
            items.push({
              type: "function_call",
              call_id: call.id,
              name: call.name,
              arguments: call.arguments,
            });
          }
        }
        return items.length > 0 ? items : [{ role: m.role, content: "" }];
      }),
    stream: true,
  };
  if (system.length) body.instructions = system.join("\n\n");
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.topP !== undefined) body.top_p = request.topP;
  if (request.maxTokens !== undefined) body.max_output_tokens = request.maxTokens;
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
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

  const type: string = record.event ?? payload?.type ?? "";
  if (type === "response.output_text.delta" && typeof payload?.delta === "string") {
    return payload.delta ? [{ type: "delta", text: payload.delta }] : [];
  }
  if (type.startsWith("response.reasoning") && type.endsWith(".delta") && typeof payload?.delta === "string") {
    return payload.delta ? [{ type: "reasoning", text: payload.delta }] : [];
  }
  if (type === "response.function_call_arguments.delta") {
    return [{
      type: "tool_call",
      callId: String(payload?.call_id ?? payload?.item_id ?? ""),
      index: typeof payload?.output_index === "number" ? payload.output_index : undefined,
      name: payload?.name ?? "",
      argumentsDelta: payload?.delta ?? "",
    }];
  }
  if (type === "response.output_item.added" && payload?.item?.type === "function_call") {
    return [{
      type: "tool_call",
      callId: String(payload.item.call_id ?? payload.item.id ?? ""),
      index: typeof payload?.output_index === "number" ? payload.output_index : undefined,
      name: payload.item.name ?? "",
      argumentsDelta: "",
    }];
  }
  if (type === "response.completed" || type === "response.incomplete") {
    const events: GatewayStreamEvent[] = [];
    const usage = payload?.response?.usage;
    if (usage && typeof usage.input_tokens === "number") {
      events.push({
        type: "usage",
        promptTokens: usage.input_tokens,
        completionTokens: usage.output_tokens ?? 0,
        totalTokens: usage.total_tokens,
      });
    }
    events.push({ type: "finish", reason: type === "response.completed" ? "stop" : "length" });
    return events;
  }
  return [];
}

export function executeResponses(
  gateway: DecryptedGatewayConfig,
  request: GatewayExecutionRequest
): AsyncGenerator<GatewayStreamEvent> {
  return streamFromGateway(gateway, "/responses", buildBody(request), parseRecord, request.signal);
}
