import { createUIMessageStreamResponse } from "ai";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError } from "@/lib/api/response";
import { getUnlockedChatSession } from "@/lib/chat/service";
import { resumeStreamHub } from "@/lib/chat/stream-hub";

type RouteContext = { params: Promise<{ chatId: string }> };

/**
 * Reconnects to the chat's in-flight generation (e.g. after a page reload),
 * replaying it from the first chunk. 204 when nothing is running.
 */
export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const { chatId } = await context.params;
    if (chatId === "no-stream") {
      return new Response(null, { status: 204, headers: { "x-request-id": requestId } });
    }
    const user = await requireUser();
    const session = await getUnlockedChatSession(user.id, chatId);

    const stream = resumeStreamHub(session.publicId);
    if (!stream) {
      return new Response(null, { status: 204, headers: { "x-request-id": requestId } });
    }

    return createUIMessageStreamResponse({
      stream,
      headers: { "x-request-id": requestId },
    });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
