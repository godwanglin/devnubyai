import { db } from "@/lib/db";
import { extractQuotes, withQuotedContext } from "./quotes";
import { extractSourceMentions, withSourceMentionNote } from "./source-mentions";

/**
 * Retrieve recent message history formatted for LLM gateway execution.
 */
export async function getRecentMessagesForGateway(
  sessionId: bigint,
  takeCount = 20
): Promise<Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }>> {
  const messages = await db.chatMessage.findMany({
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
  });

  return messages.reverse().map((m) => ({
    role: m.role as "system" | "user" | "assistant" | "tool",
    content:
      m.role === "user"
        ? withSourceMentionNote(
            withQuotedContext(m.content, extractQuotes(m.parts)),
            extractSourceMentions(m.parts)
          )
        : m.content,
  }));
}
