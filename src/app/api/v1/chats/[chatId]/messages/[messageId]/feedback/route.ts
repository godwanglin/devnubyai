import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/client";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { getChatSession } from "@/lib/chat/service";
import { stripFeedbackParts, type FeedbackPart } from "@/lib/chat/feedback";

const feedbackSchema = z.object({
  rating: z.enum(["like", "dislike"]).nullable(),
  reason: z.string().trim().max(120).optional(),
  comment: z.string().trim().max(1000).optional(),
});

type RouteContext = {
  params: Promise<{ chatId: string; messageId: string }>;
};

/**
 * PATCH /api/v1/chats/[chatId]/messages/[messageId]/feedback
 * Persists user like/dislike rating (and optional reason/comment) into ChatMessage.parts.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const { chatId, messageId } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw ApiError.badRequest("Invalid JSON body");
    }

    const parsed = feedbackSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid feedback payload", parsed.error.format());
    }

    const session = await getChatSession(user.id, chatId);

    const message = await db.chatMessage.findFirst({
      where: {
        publicId: messageId,
        sessionId: session.id,
        role: "assistant",
      },
      select: {
        id: true,
        publicId: true,
        parts: true,
      },
    });

    if (!message) {
      throw ApiError.notFound("Assistant message not found");
    }

    const cleanParts = stripFeedbackParts(message.parts);
    const { rating, reason, comment } = parsed.data;

    if (rating !== null) {
      const feedbackEntry: FeedbackPart = {
        type: "feedback",
        rating,
        ...(reason ? { reason } : {}),
        ...(comment ? { comment } : {}),
        updatedAt: new Date().toISOString(),
      };
      cleanParts.push(feedbackEntry);
    }

    await db.chatMessage.update({
      where: { id: message.id },
      data: {
        parts:
          cleanParts.length > 0
            ? (cleanParts as Prisma.InputJsonValue)
            : Prisma.DbNull,
      },
    });

    return jsonSuccess(
      {
        id: message.publicId,
        rating,
        reason: rating ? reason ?? null : null,
        comment: rating ? comment ?? null : null,
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
