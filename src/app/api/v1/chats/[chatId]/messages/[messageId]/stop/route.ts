import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { getChatSession } from "@/lib/chat/service";
import { abortStream } from "@/lib/chat/active-streams";

type RouteContext = { params: Promise<{ chatId: string; messageId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const { chatId, messageId } = await context.params;

    // Verify session belongs to user
    const session = await getChatSession(user.id, chatId);

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
