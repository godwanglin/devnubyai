import { writeLogEntry } from "@/lib/logger/file-logger";
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
 * Append-only routing log written to daily file in .logs/YYYY-MM-DD.log.
 * No database write needed, saving database connection pool & WAL disk I/O.
 * Failures to log are not allowed to break user requests.
 */
export async function logAttempt(params: AttemptLogParams): Promise<void> {
  try {
    const isError = params.outcome === "failed" || params.outcome === "aborted";
    await writeLogEntry({
      type: "routing",
      level: isError ? "error" : params.outcome === "fallback" ? "warn" : "info",
      data: {
        requestId: params.requestId,
        userId: params.userId ? params.userId.toString() : null,
        messageId: params.messageId ? params.messageId.toString() : null,
        catalogModelId: params.catalogModelId.toString(),
        gatewayId: params.gatewayId.toString(),
        upstreamModelId: params.upstreamModelId.toString(),
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
