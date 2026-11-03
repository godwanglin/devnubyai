import { db } from "@/lib/db";
import { extractQuotes, withQuotedContext } from "./quotes";
import { extractSourceMentions, withSourceMentionNote } from "./source-mentions";
import { sanitizeGatewayHistory, withProducedFilesNote } from "./turn-recovery";
import { getSessionMemoryFromRedis, drainPendingFlushes } from "./redis-chat-state";

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

  const [messages, sessionMemory] = await Promise.all([
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
    getSessionMemoryFromRedis(sessionId).catch(() => null),
  ]);

  const rawMapped = messages.reverse().map((m) => ({
    role: m.role as "system" | "user" | "assistant" | "tool",
    content:
      m.role === "user"
        ? withSourceMentionNote(
            withQuotedContext(m.content, extractQuotes(m.parts)),
            extractSourceMentions(m.parts)
          )
        : m.role === "assistant"
          ? withProducedFilesNote(m.content, m.parts)
          : m.content,
  }));

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
