import type { ToolDefinition } from "@/lib/tools/types";

/**
 * Normalized internal event stream produced by wire adapters.
 * Both `chat` (OpenAI-compatible) and `responses` adapters map to these events.
 */
export type FinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "unknown";

export type GatewayStreamEvent =
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool_call";
      /** Upstream call id; may only be present on the first fragment of a call. */
      callId: string;
      /** Stable position of the call within the response; used to join fragments. */
      index?: number;
      name: string;
      argumentsDelta: string;
    }
  | {
      type: "usage";
      promptTokens: number;
      completionTokens: number;
      totalTokens?: number;
    }
  | {
      type: "finish";
      reason: FinishReason;
    };

export interface ToolCallInput {
  id: string;
  name: string;
  arguments: string;
}

export type MultimodalContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export interface ChatMessageInput {
  role: "system" | "user" | "assistant" | "tool";
  content: string | MultimodalContentPart[];
  name?: string;
  toolCallId?: string;
  /** Tool calls requested by an assistant turn (needed before the matching `tool` messages). */
  toolCalls?: ToolCallInput[];
}

export type ReasoningEffortVariant = "off" | "low" | "medium" | "high" | "xhigh";

export interface GatewayExecutionRequest {
  model: string;
  messages: ChatMessageInput[];
  stream?: boolean;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffortVariant;
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  paramOverrides?: Record<string, unknown> | null;
  signal?: AbortSignal;
}

export interface DecryptedGatewayConfig {
  id: bigint;
  slug: string;
  name: string;
  baseUrl: string;
  wireApi: "chat" | "responses";
  modelsPath: string;
  apiKey: string;
  extraHeaders: Record<string, string> | null;
  isPrimary: boolean;
  isEnabled: boolean;
  priority: number;
  timeoutMs: number;
  firstTokenTimeoutMs: number;
  healthStatus: "unknown" | "healthy" | "degraded" | "down";
  consecutiveFailures: number;
  circuitOpenUntil: Date | null;
}

export interface CandidateRoute {
  candidateId: bigint;
  priority: number;
  paramOverrides: Record<string, unknown> | null;
  upstreamModelKey: string;
  upstreamModelId: bigint;
  gateway: DecryptedGatewayConfig;
}

export type RoutingErrorClass =
  | "timeout"
  | "network"
  | "http_5xx"
  | "rate_limited"
  | "model_not_found"
  | "auth"
  | "bad_request"
  | "client_aborted"
  | "unknown";

export interface GatewayErrorDetails {
  errorClass: RoutingErrorClass;
  httpStatus: number | null;
  message: string;
  isRetryable: boolean;
  cause?: unknown;
}
