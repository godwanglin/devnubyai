import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { getUnlockedChatSession } from "@/lib/chat/service";
import { MAX_MESSAGE_CHARS } from "@/lib/chat/service-types";
import { invalidateSharedChatCache } from "@/lib/redis/cache-keys";
import { invalidateChatSessionCache } from "@/lib/chat/session-cache";
import { invalidateHistoryCache } from "@/lib/chat/history-cache";
import { ensureSessionFlushed } from "@/lib/chat/redis-chat-state";

const updateMessageSchema = z.object({
  content: z.string().trim().min(1, "Message content cannot be empty").max(MAX_MESSAGE_CHARS),
  truncateAfter: z.boolean().optional(),
});

type RouteContext = { params: Promise<{ chatId: string; messageId: string }> };

/**
 * PATCH /api/v1/chats/[chatId]/messages/[messageId]
 * Edits a message (typically a user message) and optionally truncates/prunes
 * all subsequent conversation turns from the database so the chat branches freshly.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const { chatId, messageId } = await context.params;

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      throw ApiError.badRequest("Invalid JSON body");
    }

    const parsed = updateMessageSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid update payload", parsed.error.format());
    }

    const session = await getUnlockedChatSession(user.id, chatId);

    // Editing (and truncating) works on stored rows: store ended turns still in Redis first
    if (!(await ensureSessionFlushed(session.id))) {
      throw ApiError.conflict("Pesan sebelumnya masih disimpan. Coba lagi sebentar lagi.");
    }

    const targetMessage = await db.chatMessage.findFirst({
      where: {
        publicId: messageId,
        sessionId: session.id,
        // Only the user's own turns are editable; rewriting AI replies would forge shared chats
        role: "user",
      },
    });

    if (!targetMessage) {
      throw ApiError.notFound("Message to edit not found");
    }

    const result = await db.$transaction(async (tx) => {
      // 1. Update the message's content
      const updated = await tx.chatMessage.update({
        where: { id: targetMessage.id },
        data: {
          content: parsed.data.content,
          updatedAt: new Date(),
        },
      });

      let deletedCount = 0;
      // 2. If truncateAfter is requested, delete all subsequent messages in this session
      if (parsed.data.truncateAfter) {
        const deleted = await tx.chatMessage.deleteMany({
          where: {
            sessionId: session.id,
            id: { gt: targetMessage.id },
          },
        });
        deletedCount = deleted.count;

        await tx.chatSession.update({
          where: { id: session.id },
          data: { lastMessageAt: new Date() },
        });
      }

      return { updated, deletedCount };
    });

    // A public share link must not keep serving the pre-edit conversation
    await invalidateSharedChatCache(session.shareToken);
    await invalidateChatSessionCache(user.id, chatId);
    await invalidateHistoryCache(session.id);

    return jsonSuccess(
      {
        id: result.updated.publicId,
        content: result.updated.content,
        deletedSubsequentMessages: result.deletedCount,
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
