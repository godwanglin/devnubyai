import { db } from "@/lib/db";
import type { Prisma } from "@/generated/client";

export interface RecordToolLogInput {
  requestId?: string;
  userId?: bigint;
  sessionId?: bigint;
  messageId?: bigint;
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
 * Persists a tool execution record into `tool_execution_logs`.
 * Best-effort / fire-and-forget: never throws or blocks the chat response.
 */
export async function recordToolExecutionLog(data: RecordToolLogInput): Promise<void> {
  try {
    await db.toolExecutionLog.create({
      data: {
        requestId: data.requestId ?? null,
        userId: data.userId ?? null,
        sessionId: data.sessionId ?? null,
        messageId: data.messageId ?? null,
        toolCallId: data.toolCallId,
        toolName: data.toolName,
        success: data.success,
        errorCode: data.errorCode ?? null,
        errorText: data.errorText ?? null,
        rawArgs: data.rawArgs ?? null,
        input: data.input !== undefined ? (data.input as Prisma.InputJsonValue) : undefined,
        output: data.output !== undefined ? (data.output as Prisma.InputJsonValue) : undefined,
        durationMs: Math.max(0, Math.round(data.durationMs)),
      },
    });
  } catch (err) {
    console.error("[TOOL_LOG_ERROR] Failed to record tool execution log:", err);
  }
}
