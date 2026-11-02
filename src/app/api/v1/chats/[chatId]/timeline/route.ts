import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getUnlockedChatSession } from "@/lib/chat/service";

type RouteContext = { params: Promise<{ chatId: string }> };

export interface TimelineTurnDto {
  id: string;
  index: number;
  messageIndex: number;
  userSnippet: string;
  assistantSnippet: string;
  createdAt: string;
}

function cleanSnippet(raw: string, maxLen: number): string {
  const withoutQuoteHeader = raw.replace(
    /^\[The user selected these excerpts from the conversation and is asking about them\]\n(?:> .*\n?)+\n*/g,
    ""
  );
  const collapsed = withoutQuoteHeader.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLen) return collapsed;
  return `${collapsed.slice(0, maxLen).trimEnd()}…`;
}

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const { chatId } = await context.params;
    const session = await getUnlockedChatSession(user.id, chatId);

    const rows = await db.chatMessage.findMany({
      where: {
        sessionId: session.id,
        role: { in: ["user", "assistant"] },
      },
      orderBy: { id: "asc" },
      select: {
        publicId: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    const turns: TimelineTurnDto[] = [];
    let turnIndex = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.role === "user") {
        const nextRow = rows[i + 1];
        const assistantContent =
          nextRow && nextRow.role === "assistant" ? nextRow.content : "";

        turns.push({
          id: row.publicId,
          index: turnIndex++,
          messageIndex: i,
          userSnippet: cleanSnippet(row.content, 160),
          assistantSnippet: cleanSnippet(assistantContent, 220),
          createdAt: row.createdAt.toISOString(),
        });
      }
    }

    return jsonSuccess(
      {
        turns,
        totalMessages: rows.length,
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
