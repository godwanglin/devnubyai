import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { invalidateUserChatSessionsCache } from "@/lib/chat/session-cache";

export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();

    // Delete all chat sessions belonging to this user (cascades to messages and attachments)
    const result = await db.chatSession.deleteMany({
      where: { userId: user.id },
    });

    await invalidateUserChatSessionsCache(user.id);
    return jsonSuccess({ cleared: true, count: result.count }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
