import { toMessageDto } from "./mappers";
import { withProducedFilesNote } from "./turn-recovery";
import type { ChatMessageDto } from "./service-types";
import type { HistoryEntry } from "./history-cache";
import type { PendingTurn } from "./redis-chat-state";

/**
 * Readers' view of turns still held in Redis (streaming, or waiting for Postgres):
 * the same DTOs / history entries the stored rows would produce.
 */

function assistantDto(turn: PendingTurn, sessionPublicId: string): ChatMessageDto {
  const a = turn.assistant;
  const at = new Date(turn.updatedAt);
  return toMessageDto(
    {
      publicId: a.publicId,
      role: "assistant",
      content: a.content,
      reasoning: a.reasoning,
      parts: a.parts.length > 0 ? a.parts : null,
      status: a.status,
      errorCode: a.errorCode,
      promptTokens: a.promptTokens || null,
      completionTokens: a.completionTokens || null,
      catalogModel: { publicId: a.catalogModelPublicId },
      createdAt: new Date(turn.startedAt),
      updatedAt: at,
    },
    sessionPublicId
  );
}

function userDto(turn: PendingTurn, sessionPublicId: string): ChatMessageDto | null {
  const u = turn.user;
  if (!u) return null;
  const at = new Date(turn.startedAt);
  return toMessageDto(
    {
      publicId: u.publicId,
      role: "user",
      content: u.content,
      reasoning: null,
      parts: u.parts && u.parts.length > 0 ? u.parts : null,
      status: "completed",
      errorCode: null,
      promptTokens: null,
      completionTokens: null,
      files: u.attachments.map((f) => ({ ...f, sizeBytes: BigInt(f.sizeBytes) })),
      createdAt: at,
      updatedAt: at,
    },
    sessionPublicId
  );
}

/**
 * Appends pending "send" turns after the stored messages and overlays pending
 * regenerations onto the stored reply they rewrite. Rows already stored win.
 */
export function mergePendingTurns(
  stored: ChatMessageDto[],
  turns: PendingTurn[],
  sessionPublicId: string
): ChatMessageDto[] {
  if (turns.length === 0) return stored;
  const result = [...stored];
  const indexById = new Map(result.map((m, idx) => [m.id, idx]));

  for (const turn of turns) {
    if (turn.kind === "regenerate") {
      const idx = indexById.get(turn.assistant.publicId);
      if (idx !== undefined) result[idx] = assistantDto(turn, sessionPublicId);
      continue;
    }
    const user = userDto(turn, sessionPublicId);
    if (user && !indexById.has(user.id)) result.push(user);
    if (!indexById.has(turn.assistant.publicId)) result.push(assistantDto(turn, sessionPublicId));
  }
  return result;
}

/** Gateway history entries of ended turns not stored in Postgres yet. */
export function pendingHistoryEntries(turns: PendingTurn[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const turn of turns) {
    if (turn.kind !== "send" || turn.assistant.status === "streaming") continue;
    if (turn.user) entries.push({ role: "user", content: turn.user.historyContent });
    if (turn.assistant.status === "completed" || turn.assistant.status === "aborted") {
      entries.push({
        role: "assistant",
        content: withProducedFilesNote(turn.assistant.content, turn.assistant.parts),
      });
    }
  }
  return entries;
}
