import type { DecryptedGatewayConfig, GatewayStreamEvent } from "../types";
import { parseSseStream, type SseRecord } from "../sse";
import {
  GatewayError,
  classifyHttpError,
  classifyThrownError,
  isUpstreamRateLimitText,
} from "@/lib/routing/errors";

/**
 * Shared POST + SSE pipeline for wire adapters.
 * - `gateway.timeoutMs` bounds the whole request.
 * - `gateway.firstTokenTimeoutMs` bounds the wait for the first normalized event.
 */
export async function* streamFromGateway(
  gateway: DecryptedGatewayConfig,
  path: string,
  body: Record<string, unknown>,
  parseRecord: (record: SseRecord) => GatewayStreamEvent[],
  signal?: AbortSignal
): AsyncGenerator<GatewayStreamEvent> {
  const controller = new AbortController();
  let timedOut = false;
  const abortOnTimeout = () => {
    timedOut = true;
    controller.abort();
  };

  const rawEffort =
    typeof body.reasoning_effort === "string"
      ? body.reasoning_effort.toLowerCase()
      : typeof (body.reasoning as Record<string, unknown> | undefined)?.effort === "string"
        ? String((body.reasoning as Record<string, unknown>).effort).toLowerCase()
        : "";
  const isDeepReasoning = rawEffort === "high" || rawEffort === "xhigh" || rawEffort === "ultra" || rawEffort === "max";
  const isModerateReasoning = rawEffort === "medium" || rawEffort === "low";

  const effectiveFirstTokenTimeoutMs = isDeepReasoning
    ? Math.max(gateway.firstTokenTimeoutMs, 60_000)
    : isModerateReasoning
      ? Math.max(gateway.firstTokenTimeoutMs, 35_000)
      : gateway.firstTokenTimeoutMs;

  const effectiveTotalTimeoutMs = isDeepReasoning
    ? Math.max(gateway.timeoutMs, 180_000)
    : gateway.timeoutMs;

  const totalTimer = setTimeout(abortOnTimeout, effectiveTotalTimeoutMs);
  let firstTokenTimer: ReturnType<typeof setTimeout> | null = setTimeout(
    abortOnTimeout,
    effectiveFirstTokenTimeoutMs
  );
  const abortFromClient = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abortFromClient, { once: true });

  try {
    const response = await fetch(`${gateway.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: `Bearer ${gateway.apiKey}`,
        ...(gateway.extraHeaders ?? {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new GatewayError({
        errorClass: classifyHttpError(response.status, text),
        httpStatus: response.status,
        message: `Gateway returned HTTP ${response.status}`,
      });
    }
    if (!response.body) {
      throw new GatewayError({
        errorClass: "network",
        httpStatus: null,
        message: "Gateway returned an empty response body",
      });
    }

    let accumulatedText = "";
    let isCheckingInitial = true;
    const initialBuffer: GatewayStreamEvent[] = [];

    for await (const record of parseSseStream(response.body)) {
      for (const event of parseRecord(record)) {
        if (isCheckingInitial) {
          if (event.type === "delta" && typeof event.text === "string") {
            accumulatedText += event.text;
            initialBuffer.push(event);

            if (isUpstreamRateLimitText(accumulatedText)) {
              throw new GatewayError({
                errorClass: "rate_limited",
                httpStatus: 429,
                message: "Anda sudah mencapai batas pada model ini. Silakan coba lagi nanti.",
              });
            }

            const trimmed = accumulatedText.trimStart();
            const couldBeBanner =
              (trimmed.startsWith("[") && ("[ChatGPT".startsWith(trimmed) || trimmed.toLowerCase().startsWith("[chatgpt"))) ||
              ("anda sudah".startsWith(trimmed.toLowerCase()) || trimmed.toLowerCase().startsWith("anda sudah"));

            // If it can no longer be the banner, or exceeds banner check length, flush buffer
            if (!couldBeBanner || accumulatedText.length >= 140) {
              isCheckingInitial = false;
              for (const buffered of initialBuffer) {
                if (firstTokenTimer) {
                  clearTimeout(firstTokenTimer);
                  firstTokenTimer = null;
                }
                yield buffered;
              }
              initialBuffer.length = 0;
            }
            continue;
          }

          // If non-delta arrives while buffer is empty, yield normally
          if (initialBuffer.length === 0) {
            if (firstTokenTimer) {
              clearTimeout(firstTokenTimer);
              firstTokenTimer = null;
            }
            yield event;
            continue;
          } else {
            initialBuffer.push(event);
            continue;
          }
        }

        if (firstTokenTimer) {
          clearTimeout(firstTokenTimer);
          firstTokenTimer = null;
        }
        yield event;
      }
    }

    // Flush any remaining buffered events if stream ended cleanly without error
    if (isCheckingInitial && initialBuffer.length > 0) {
      if (isUpstreamRateLimitText(accumulatedText)) {
        throw new GatewayError({
          errorClass: "rate_limited",
          httpStatus: 429,
          message: "Anda sudah mencapai batas pada model ini. Silakan coba lagi nanti.",
        });
      }
      for (const buffered of initialBuffer) {
        if (firstTokenTimer) {
          clearTimeout(firstTokenTimer);
          firstTokenTimer = null;
        }
        yield buffered;
      }
      initialBuffer.length = 0;
    }
  } catch (err) {
    throw classifyThrownError(err, {
      timedOut,
      clientAborted: Boolean(signal?.aborted),
    });
  } finally {
    clearTimeout(totalTimer);
    if (firstTokenTimer) clearTimeout(firstTokenTimer);
    signal?.removeEventListener("abort", abortFromClient);
  }
}
