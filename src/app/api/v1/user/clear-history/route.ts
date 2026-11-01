import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";

export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();

    // Delete all chat sessions belonging to this user (cascades to messages and attachments)
    const result = await db.chatSession.deleteMany({
      where: { userId: user.id },
    });

    return jsonSuccess({ cleared: true, count: result.count }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
