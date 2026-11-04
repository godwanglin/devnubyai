import type { DecryptedGatewayConfig, GatewayStreamEvent } from "../types";
import { parseSseStream, type SseRecord } from "../sse";
import {
  GatewayError,
  classifyHttpError,
  classifyThrownError,
  isUpstreamRateLimitText,
} from "@/lib/routing/errors";
import { validateSafeUrlCached } from "@/lib/tools/ssrf";

/**
 * Shared POST + SSE pipeline for wire adapters.
 * - `gateway.timeoutMs` bounds per-chunk inactivity (resets on every SSE chunk so long tool calls never get killed mid-stream).
 * - `gateway.firstTokenTimeoutMs` bounds the wait for the first normalized content event.
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
        : typeof (body.output_config as Record<string, unknown> | undefined)?.effort === "string"
          ? String((body.output_config as Record<string, unknown>).effort).toLowerCase()
          : "";
  const hasClaudeThinking = Boolean(body.thinking && typeof body.thinking === "object");
  const hasGeminiThinking = Boolean(
    ((body.request as Record<string, unknown> | undefined)?.generationConfig as Record<string, unknown> | undefined)
      ?.thinkingConfig
  );
  const isDeepReasoning =
    rawEffort === "high" ||
    rawEffort === "xhigh" ||
    rawEffort === "ultra" ||
    rawEffort === "max";
  const isModerateReasoning =
    rawEffort === "medium" ||
    rawEffort === "low" ||
    hasClaudeThinking ||
    hasGeminiThinking;

  const effectiveFirstTokenTimeoutMs = isDeepReasoning
    ? Math.max(gateway.firstTokenTimeoutMs, 75_000)
    : isModerateReasoning
      ? Math.max(gateway.firstTokenTimeoutMs, 45_000)
      : Math.max(gateway.firstTokenTimeoutMs, 30_000);

  // Per-chunk inactivity timeout: resets every time the stream yields data so long
  // tool calls (e.g. multi-page PDF/DOCX scripts) are never killed at 120s mid-stream.
  const chunkIdleTimeoutMs = isDeepReasoning
    ? Math.max(gateway.timeoutMs, 180_000)
    : Math.max(gateway.timeoutMs, 120_000);
  // Absolute wall-clock ceiling (10 minutes) to guard against infinite slow-drip streams.
  const maxWallTimeoutMs = Math.max(gateway.timeoutMs * 5, 600_000);

  const wallTimer = setTimeout(abortOnTimeout, maxWallTimeoutMs);
  let idleTimer: ReturnType<typeof setTimeout> | null = setTimeout(
    abortOnTimeout,
    chunkIdleTimeoutMs
  );
  const refreshIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(abortOnTimeout, chunkIdleTimeoutMs);
  };
  let firstTokenTimer: ReturnType<typeof setTimeout> | null = setTimeout(
    abortOnTimeout,
    effectiveFirstTokenTimeoutMs
  );
  const abortFromClient = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abortFromClient, { once: true });

  try {
    const targetUrl = `${gateway.baseUrl}${path}`;
    // Gateways must be public: re-check DNS (cached) so a hostname can't be pointed at internal hosts
    const ssrfCheck = await validateSafeUrlCached(targetUrl);
    if (!ssrfCheck.safe) {
      throw new GatewayError({
        errorClass: "network",
        httpStatus: null,
        message: `Gateway target blocked: ${ssrfCheck.reason}`,
      });
    }

    const response = await fetch(targetUrl, {
      method: "POST",
      // Never follow redirects with the API key attached; a 3xx surfaces as an HTTP error
      redirect: "manual",
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
        rawProviderText: text,
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
      refreshIdleTimer();
      for (const event of parseRecord(record)) {
        // Clear firstTokenTimer only once real model output (reasoning, delta, tool_call) arrives,
        // not on the initial empty message_start usage frame.
        const isContentEvent =
          event.type === "delta" || event.type === "reasoning" || event.type === "tool_call";
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
            if (isContentEvent && firstTokenTimer) {
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

        if (isContentEvent && firstTokenTimer) {
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
    clearTimeout(wallTimer);
    if (idleTimer) clearTimeout(idleTimer);
    if (firstTokenTimer) clearTimeout(firstTokenTimer);
    signal?.removeEventListener("abort", abortFromClient);
  }
}
