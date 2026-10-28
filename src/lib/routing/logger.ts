import { db } from "@/lib/db";
import type { GatewayError } from "./errors";

export interface AttemptLogParams {
  requestId: string;
  userId?: bigint | null;
  messageId?: bigint | null;
  catalogModelId: bigint;
  gatewayId: bigint;
  upstreamModelId: bigint;
  attemptNo: number;
  outcome: "success" | "fallback" | "failed" | "aborted";
  error?: GatewayError;
  latencyMs: number;
  ttftMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
}

/**
 * Append-only routing log. No raw upstream message or secrets are persisted.
 * Failures to log are not allowed to break user requests.
 */
export async function logAttempt(params: AttemptLogParams): Promise<void> {
  try {
    await db.routingAttempt.create({
      data: {
        requestId: params.requestId,
        userId: params.userId ?? null,
        messageId: params.messageId ?? null,
        catalogModelId: params.catalogModelId,
        gatewayId: params.gatewayId,
        upstreamModelId: params.upstreamModelId,
        attemptNo: params.attemptNo,
        outcome: params.outcome,
        errorClass: params.error?.errorClass ?? null,
        httpStatus: params.error?.httpStatus ?? null,
        latencyMs: params.latencyMs,
        ttftMs: params.ttftMs ?? null,
        promptTokens: params.promptTokens ?? null,
        completionTokens: params.completionTokens ?? null,
      },
    });
  } catch (err) {
    console.error(`[ROUTING_ATTEMPT_LOG_ERROR] [${params.requestId}]`, err);
  }
}
