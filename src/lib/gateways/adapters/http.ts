import type { DecryptedGatewayConfig, GatewayStreamEvent } from "../types";
import { parseSseStream, type SseRecord } from "../sse";
import { GatewayError, classifyHttpError, classifyThrownError } from "@/lib/routing/errors";

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
  const totalTimer = setTimeout(abortOnTimeout, gateway.timeoutMs);
  let firstTokenTimer: ReturnType<typeof setTimeout> | null = setTimeout(
    abortOnTimeout,
    gateway.firstTokenTimeoutMs
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

    for await (const record of parseSseStream(response.body)) {
      for (const event of parseRecord(record)) {
        if (firstTokenTimer) {
          clearTimeout(firstTokenTimer);
          firstTokenTimer = null;
        }
        yield event;
      }
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
