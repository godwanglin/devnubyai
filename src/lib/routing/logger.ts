import { writeLogEntry } from "@/lib/logger/file-logger";
import { computeCostUsd, toUsd } from "@/lib/billing/cost";
import type { GatewayError } from "./errors";

export interface CandidateAttemptLogEntry {
  attemptNo: number;
  gatewayId: string;
  gatewayName: string;
  upstreamModelId: string;
  upstreamModelKey: string;
  outcome: "success" | "fallback" | "failed" | "aborted";
  errorRuleId: string | null;
  errorClass: string | null;
  httpStatus: number | null;
  providerError: string | null;
  rawProviderError?: string | null;
  latencyMs: number;
  ttftMs: number | null;
}

export interface AttemptLogParams {
  requestId: string;
  userId?: bigint | null;
  messageId?: bigint | null;
  catalogModelId: bigint;
  catalogModelPublicId: string;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  gatewayId: bigint;
  gatewayName: string;
  upstreamModelId: bigint;
  upstreamModelKey: string;
  attemptNo: number;
  outcome: "success" | "fallback" | "failed" | "aborted";
  hadFallback?: boolean;
  error?: GatewayError;
  clientError?: string | null;
  latencyMs: number;
  ttftMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  candidates?: CandidateAttemptLogEntry[];
}

/**
 * Append-only routing log written as 1 consolidated <log ... userid="..."> block per request
 * to daily file in .logs/YYYY-MM-DD.log, including candidate attempts, cost ($), and mapped errors.
 */
export async function logAttempt(params: AttemptLogParams): Promise<void> {
  try {
    const isError = params.outcome === "failed" || params.outcome === "aborted";
    const hadFallback = Boolean(params.hadFallback || (params.candidates && params.candidates.length > 1));
    const userIdStr = params.userId ? params.userId.toString() : null;

    const pTokens = params.promptTokens ?? 0;
    const cTokens = params.completionTokens ?? 0;
    const inPrice = params.inputPricePerMillion ?? 0;
    const outPrice = params.outputPricePerMillion ?? 0;
    const costUsd = toUsd(computeCostUsd(pTokens, cTokens, inPrice, outPrice));

    const finalClientError = isError
      ? (params.clientError ?? params.error?.clientError ?? null)
      : null;

    await writeLogEntry({
      type: "routing",
      level: isError ? "error" : hadFallback || params.outcome === "fallback" ? "warn" : "info",
      userId: userIdStr,
      data: {
        requestId: params.requestId,
        userId: userIdStr,
        messageId: params.messageId ? params.messageId.toString() : null,
        catalogModelId: params.catalogModelId.toString(),
        catalogModelPublicId: params.catalogModelPublicId,
        gatewayId: params.gatewayId.toString(),
        gatewayName: params.gatewayName,
        upstreamModelId: params.upstreamModelId.toString(),
        upstreamModelKey: params.upstreamModelKey,
        attemptNo: params.attemptNo,
        outcome: params.outcome,
        hadFallback,
        errorRuleId: params.error?.errorRuleId ?? null,
        errorClass: params.error?.errorClass ?? null,
        httpStatus: params.error?.httpStatus ?? null,
        providerError: params.error?.providerError ?? null,
        rawProviderError: params.error?.rawProviderError ?? null,
        clientError: finalClientError,
        latencyMs: params.latencyMs,
        ttftMs: params.ttftMs ?? null,
        promptTokens: params.promptTokens ?? null,
        completionTokens: params.completionTokens ?? null,
        costUsd,
        candidates: params.candidates ?? [
          {
            attemptNo: params.attemptNo,
            gatewayId: params.gatewayId.toString(),
            gatewayName: params.gatewayName,
            upstreamModelId: params.upstreamModelId.toString(),
            upstreamModelKey: params.upstreamModelKey,
            outcome: params.outcome,
            errorRuleId: params.error?.errorRuleId ?? null,
            errorClass: params.error?.errorClass ?? null,
            httpStatus: params.error?.httpStatus ?? null,
            providerError: params.error?.providerError ?? null,
            rawProviderError: params.error?.rawProviderError ?? null,
            latencyMs: params.latencyMs,
            ttftMs: params.ttftMs ?? null,
          },
        ],
      },
    });
  } catch (err) {
    console.error(`[ROUTING_ATTEMPT_LOG_ERROR] [${params.requestId}]`, err);
  }
}
