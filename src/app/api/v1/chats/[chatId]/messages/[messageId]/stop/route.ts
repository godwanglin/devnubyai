import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { getChatSession } from "@/lib/chat/service";
import { abortStream } from "@/lib/chat/active-streams";
import { completeTurn, getTurn } from "@/lib/chat/redis-chat-state";

type RouteContext = { params: Promise<{ chatId: string; messageId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const { chatId, messageId } = await context.params;

    // Verify session belongs to user
    const session = await getChatSession(user.id, chatId);

    // A streaming reply lives in Redis: abort it there; the generation stores it as aborted
    const turn = await getTurn(messageId);
    if (turn && turn.sessionId === session.id.toString()) {
      const aborted = abortStream(messageId);
      if (!aborted && turn.assistant.status === "streaming") {
        // No live generation in this process (it died): close the turn ourselves
        turn.assistant.status = "aborted";
        turn.assistant.errorCode = "CLIENT_STOPPED";
        await completeTurn(turn);
      }
      return jsonSuccess({ id: messageId, status: "aborted" }, { requestId });
    }

    // Find the message
    const message = await db.chatMessage.findFirst({
      where: {
        publicId: messageId,
        sessionId: session.id,
      },
    });

    if (!message) {
      throw ApiError.notFound("Message not found");
    }

    // Abort the in-flight generation stream if active
    abortStream(message.publicId);

    // Update DB status if still streaming
    if (message.status === "streaming") {
      await db.chatMessage.update({
        where: { id: message.id },
        data: {
          status: "aborted",
          errorCode: "CLIENT_STOPPED",
        },
      });
    }

    return jsonSuccess(
      {
        id: message.publicId,
        status: "aborted",
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
