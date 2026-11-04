import { db } from "@/lib/db";
import { extractQuotes, withQuotedContext } from "./quotes";
import { extractSourceMentions, withSourceMentionNote } from "./source-mentions";
import { sanitizeGatewayHistory, withProducedFilesNote } from "./turn-recovery";
import { getSessionMemoryFromRedis, drainPendingFlushes, listSessionTurns } from "./redis-chat-state";
import { readCachedHistory, writeCachedHistory, type HistoryEntry } from "./history-cache";
import { pendingHistoryEntries } from "./pending-turns";

/** Text the gateway sees for a user message: quotes and @mentions folded in. */
export function userHistoryContent(content: string, parts: unknown): string {
  return withSourceMentionNote(withQuotedContext(content, extractQuotes(parts)), extractSourceMentions(parts));
}

/** Last `takeCount` ended messages of a chat: Redis cache, else Postgres + turns not yet stored. */
async function loadHistoryEntries(sessionId: bigint, takeCount: number): Promise<HistoryEntry[]> {
  const cached = await readCachedHistory(sessionId, takeCount);
  if (cached) return cached;

  const [messages, pendingTurns] = await Promise.all([
    db.chatMessage.findMany({
      where: {
        sessionId,
        status: { in: ["completed", "aborted"] },
      },
      orderBy: { id: "desc" },
      take: takeCount,
      select: {
        role: true,
        content: true,
        parts: true,
      },
    }),
    listSessionTurns(sessionId),
  ]);

  const entries: HistoryEntry[] = [
    ...messages.reverse().map((m) => ({
      role: m.role as HistoryEntry["role"],
      content:
        m.role === "user"
          ? userHistoryContent(m.content, m.parts)
          : m.role === "assistant"
            ? withProducedFilesNote(m.content, m.parts)
            : m.content,
    })),
    ...pendingHistoryEntries(pendingTurns),
  ].slice(-takeCount);

  await writeCachedHistory(sessionId, entries);
  return entries;
}

/**
 * Retrieve recent message history formatted for LLM gateway execution.
 * Integrates Redis working memory and triggers lazy drainage of any pending flushes.
 */
export async function getRecentMessagesForGateway(
  sessionId: bigint,
  takeCount = 20
): Promise<Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }>> {
  // Fire-and-forget lazy drain of any pending background flushes
  void drainPendingFlushes(5).catch(() => {});

  const [entries, sessionMemory] = await Promise.all([
    loadHistoryEntries(sessionId, takeCount),
    getSessionMemoryFromRedis(sessionId).catch(() => null),
  ]);
  // Copies: the session-memory note must not leak into the cached entries
  const rawMapped = entries.map((e) => ({ ...e }));

  // If session working memory has produced files that might not yet be in older turns, inject memory cue
  if (sessionMemory?.filesProduced?.length) {
    const memoryNote = `[Active Session Working Memory: Produced files in this chat = ${sessionMemory.filesProduced
      .map((f) => f.displayName || f.filename)
      .join(", ")}]`;

    // Attach to earliest system message or insert as a system reminder
    const firstSystem = rawMapped.find((m) => m.role === "system");
    if (firstSystem) {
      firstSystem.content = `${firstSystem.content}\n\n${memoryNote}`;
    } else {
      rawMapped.unshift({ role: "system", content: memoryNote });
    }
  }

  return sanitizeGatewayHistory(rawMapped);
}
