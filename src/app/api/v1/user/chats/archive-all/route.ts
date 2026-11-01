import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";

export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();

    const result = await db.chatSession.updateMany({
      where: {
        userId: user.id,
        isArchived: false,
      },
      data: {
        isArchived: true,
      },
    });

    return jsonSuccess({ archived: true, count: result.count }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
