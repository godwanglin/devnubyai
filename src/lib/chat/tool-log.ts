import { writeLogEntry } from "@/lib/logger/file-logger";

export interface RecordToolLogInput {
  requestId?: string;
  userId?: bigint;
  sessionId?: bigint;
  /** Assistant message public id (the row is stored in Postgres only at turn end) */
  messageId?: bigint | string;
  toolCallId: string;
  toolName: string;
  success: boolean;
  errorCode?: string;
  errorText?: string;
  rawArgs?: string;
  input?: unknown;
  output?: unknown;
  durationMs: number;
}

/**
 * Persists a tool execution record into .logs/YYYY-MM-DD.log.
 * Best-effort / fire-and-forget: never throws or blocks the chat response.
 * Only writes when admin setting `chat.tool_debug` is enabled (checked by caller).
 */
export async function recordToolExecutionLog(data: RecordToolLogInput): Promise<void> {
  try {
    await writeLogEntry({
      type: "tool",
      level: data.success ? "info" : "error",
      data: {
        requestId: data.requestId ?? null,
        userId: data.userId ? data.userId.toString() : null,
        sessionId: data.sessionId ? data.sessionId.toString() : null,
        messageId: data.messageId ? data.messageId.toString() : null,
        toolCallId: data.toolCallId,
        toolName: data.toolName,
        success: data.success,
        errorCode: data.errorCode ?? null,
        errorText: data.errorText ?? null,
        rawArgs: data.rawArgs ?? null,
        input: data.input !== undefined ? data.input : null,
        output: data.output !== undefined ? data.output : null,
        durationMs: Math.max(0, Math.round(data.durationMs)),
      },
    });
  } catch (err) {
    console.error("[TOOL_LOG_ERROR] Failed to record tool execution log:", err);
  }
}
