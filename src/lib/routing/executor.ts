import { uuidv7 } from "@/lib/api/uuidv7";
import { ApiError } from "@/lib/api/response";
import type {
  CandidateRoute,
  GatewayExecutionRequest,
  GatewayStreamEvent,
} from "@/lib/gateways/types";
import { dispatchGatewayStream } from "@/lib/gateways/dispatcher";
import { markFailure, markSuccess } from "./circuit";
import { GatewayError, classifyThrownError, shouldFallback } from "./errors";
import { GLOBAL_DEFAULT_ERROR } from "./error-mapping";
import { logAttempt, type AttemptLogParams, type CandidateAttemptLogEntry } from "./logger";
import { resolveCandidates } from "./resolver";
import { getRoutingSettings } from "./settings";
import { markRouteCooldown } from "./strategy";

export interface ExecuteWithFallbackOptions {
  publicModelId?: string | null;
  request: Omit<GatewayExecutionRequest, "model" | "paramOverrides">;
  requestId?: string;
  userId?: bigint | null;
  /** Assistant message (public id; the row may not be in Postgres yet) */
  messageId?: bigint | string | null;
}

/**
 * Try candidates in order until one produces its first event. From that
 * point the stream is committed to that gateway: mid-stream errors are
 * surfaced to the caller and never fall back (no mixed answers).
 *
 * Throws `ApiError.modelUnavailable()` when every candidate failed before
 * the first event, or `GatewayError` for client aborts / mid-stream failures.
 */
export async function* executeWithFallback(
  options: ExecuteWithFallbackOptions
): AsyncGenerator<GatewayStreamEvent> {
  const requestId = options.requestId ?? uuidv7();
  const settings = await getRoutingSettings();
  const resolved = await resolveCandidates(options.publicModelId);
  if (resolved.candidates.length === 0) throw ApiError.modelUnavailable();

  const signal = options.request.signal;
  const overallStartedAt = Date.now();
  const candidateLogs: CandidateAttemptLogEntry[] = [];

  for (let index = 0; index < resolved.candidates.length; index += 1) {
    const candidate: CandidateRoute = resolved.candidates[index];
    const startedAt = Date.now();
    let firstEventAt: number | null = null;
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    let settled = false;

    const recordCandidate = (
      outcome: CandidateAttemptLogEntry["outcome"],
      error?: GatewayError
    ): CandidateAttemptLogEntry => {
      const entry: CandidateAttemptLogEntry = {
        attemptNo: index + 1,
        gatewayId: candidate.gateway.id.toString(),
        gatewayName: candidate.gateway.name,
        upstreamModelId: candidate.upstreamModelId.toString(),
        upstreamModelKey: candidate.upstreamModelKey,
        outcome,
        errorRuleId: error?.errorRuleId ?? null,
        errorClass: error?.errorClass ?? null,
        httpStatus: error?.httpStatus ?? null,
        providerError: error?.providerError ?? null,
        rawProviderError: error?.rawProviderError ?? null,
        latencyMs: Date.now() - startedAt,
        ttftMs: firstEventAt === null ? null : firstEventAt - startedAt,
      };
      candidateLogs.push(entry);
      return entry;
    };

    const flushConsolidatedLog = (
      outcome: AttemptLogParams["outcome"],
      error?: GatewayError,
      clientErrorOverride?: string | null
    ) => {
      recordCandidate(outcome, error);
      return logAttempt({
        requestId,
        userId: options.userId,
        messageId: options.messageId,
        catalogModelId: resolved.catalogModelId,
        catalogModelPublicId: resolved.publicId,
        inputPricePerMillion: resolved.inputPricePerMillion,
        outputPricePerMillion: resolved.outputPricePerMillion,
        gatewayId: candidate.gateway.id,
        gatewayName: candidate.gateway.name,
        upstreamModelId: candidate.upstreamModelId,
        upstreamModelKey: candidate.upstreamModelKey,
        attemptNo: index + 1,
        outcome,
        hadFallback: index > 0,
        error,
        clientError: clientErrorOverride ?? error?.clientError ?? null,
        latencyMs: Date.now() - overallStartedAt,
        ttftMs: firstEventAt === null ? null : firstEventAt - startedAt,
        promptTokens,
        completionTokens,
        candidates: candidateLogs,
      });
    };

    try {
      const stream = dispatchGatewayStream(candidate.gateway, {
        ...options.request,
        model: candidate.upstreamModelKey,
        paramOverrides: candidate.paramOverrides,
      });

      for await (const event of stream) {
        if (firstEventAt === null) {
          firstEventAt = Date.now();
          markSuccess(candidate.gateway.id);
        }
        if (event.type === "usage") {
          promptTokens = event.promptTokens;
          completionTokens = event.completionTokens;
        }
        yield event;
      }

      if (firstEventAt === null) {
        // Stream ended cleanly without producing anything: treat as an upstream failure.
        throw new GatewayError({
          errorClass: "network",
          httpStatus: null,
          message: "Gateway stream ended without any event",
        });
      }

      settled = true;
      await flushConsolidatedLog("success");
      return;
    } catch (err) {
      settled = true;
      const error =
        err instanceof GatewayError
          ? err
          : classifyThrownError(err, { timedOut: false, clientAborted: Boolean(signal?.aborted) });

      if (error.errorClass === "client_aborted") {
        await flushConsolidatedLog("aborted", error);
        throw error;
      }

      markFailure(candidate.gateway.id, error, settings);
      // Round robin: park this route so following requests pick the others first.
      // Only for upstream-side failures (the ones configured to trigger fallback).
      if (resolved.strategy === "round_robin" && shouldFallback(error, settings)) {
        markRouteCooldown(candidate.candidateId, resolved.routeCooldownSeconds);
      }

      if (firstEventAt !== null) {
        // Already committed to this gateway: no fallback mid-stream.
        await flushConsolidatedLog("failed", error);
        throw error;
      }

      const hasNext = index + 1 < resolved.candidates.length;
      const fallback = hasNext && shouldFallback(error, settings);
      if (fallback) {
        recordCandidate("fallback", error);
        continue;
      }

      const clientMsg = error.clientError || GLOBAL_DEFAULT_ERROR.clientMessage;
      await flushConsolidatedLog("failed", error, clientMsg);
      throw ApiError.modelUnavailable(clientMsg);
    } finally {
      // Consumer stopped iterating (e.g. client disconnected) after the first event.
      if (!settled && firstEventAt !== null) {
        void flushConsolidatedLog("aborted");
      }
    }
  }

  throw ApiError.modelUnavailable(GLOBAL_DEFAULT_ERROR.clientMessage);
}
