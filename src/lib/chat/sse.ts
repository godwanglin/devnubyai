/**
 * Standardized Server-Sent Events (SSE) stream formatting for Devnuby AI.
 * Event flow: meta -> optional reasoning -> delta* -> optional tool* -> ping* -> done | error
 */

export type SseServerEvent =
  | {
      event: "meta";
      data: {
        messageId: string;
        userMessageId: string;
        model: string;
      };
    }
  | {
      event: "reasoning";
      data: {
        delta: string;
      };
    }
  | {
      event: "delta";
      data: {
        delta: string;
      };
    }
  | {
      event: "tool";
      data: {
        id?: string;
        name: string;
        status: "running" | "completed" | "failed";
        output?: unknown;
        error?: string;
      };
    }
  | {
      event: "ping";
      data: Record<string, never>;
    }
  | {
      event: "done";
      data: {
        finishReason: string;
        usage?: {
          promptTokens: number;
          completionTokens: number;
          totalTokens?: number;
        };
      };
    }
  | {
      event: "error";
      data: {
        code: string;
        message: string;
        requestId?: string;
      };
    };

export function formatSseChunk(event: SseServerEvent): string {
  const dataString = JSON.stringify(event.data);
  return `event: ${event.event}\ndata: ${dataString}\n\n`;
}

export function getSseResponseHeaders(requestId?: string): HeadersInit {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...(requestId ? { "x-request-id": requestId } : {}),
  };
}
