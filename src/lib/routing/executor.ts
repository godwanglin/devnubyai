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
import { logAttempt, type AttemptLogParams } from "./logger";
import { resolveCandidates } from "./resolver";
import { getRoutingSettings } from "./settings";

export interface ExecuteWithFallbackOptions {
  publicModelId?: string | null;
  request: Omit<GatewayExecutionRequest, "model" | "paramOverrides">;
  requestId?: string;
  userId?: bigint | null;
  messageId?: bigint | null;
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

  for (let index = 0; index < resolved.candidates.length; index += 1) {
    const candidate: CandidateRoute = resolved.candidates[index];
    const startedAt = Date.now();
    let firstEventAt: number | null = null;
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    let settled = false;

    const log = (
      outcome: AttemptLogParams["outcome"],
      error?: GatewayError
    ) =>
      logAttempt({
        requestId,
        userId: options.userId,
        messageId: options.messageId,
        catalogModelId: resolved.catalogModelId,
        gatewayId: candidate.gateway.id,
        upstreamModelId: candidate.upstreamModelId,
        attemptNo: index + 1,
        outcome,
        error,
        latencyMs: Date.now() - startedAt,
        ttftMs: firstEventAt === null ? null : firstEventAt - startedAt,
        promptTokens,
        completionTokens,
      });

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
      await log("success");
      return;
    } catch (err) {
      settled = true;
      const error =
        err instanceof GatewayError
          ? err
          : classifyThrownError(err, { timedOut: false, clientAborted: Boolean(signal?.aborted) });

      if (error.errorClass === "client_aborted") {
        await log("aborted", error);
        throw error;
      }

      markFailure(candidate.gateway.id, error, settings);

      if (firstEventAt !== null) {
        // Already committed to this gateway: no fallback mid-stream.
        await log("failed", error);
        throw error;
      }

      const hasNext = index + 1 < resolved.candidates.length;
      const fallback = hasNext && shouldFallback(error, settings);
      await log(fallback ? "fallback" : "failed", error);
      if (!fallback) break;
    } finally {
      // Consumer stopped iterating (e.g. client disconnected) after the first event.
      if (!settled && firstEventAt !== null) {
        void log("aborted");
      }
    }
  }

  throw ApiError.modelUnavailable();
}
