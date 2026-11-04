import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { invalidateUserChatSessionsCache } from "@/lib/chat/session-cache";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();

    const sharedSessions = await db.chatSession.findMany({
      where: {
        userId: user.id,
        shareToken: { not: null },
      },
      select: {
        publicId: true,
        title: true,
        shareToken: true,
        sharedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { sharedAt: "desc" },
    });

    const links = sharedSessions.map((s) => ({
      id: s.publicId,
      title: s.title,
      shareToken: s.shareToken,
      sharedAt: s.sharedAt ? s.sharedAt.toISOString() : s.createdAt.toISOString(),
      url: `/share/${s.shareToken}`,
    }));

    return jsonSuccess({ links }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const revokeAll = url.searchParams.get("all") === "true";

    if (revokeAll) {
      const result = await db.chatSession.updateMany({
        where: {
          userId: user.id,
          shareToken: { not: null },
        },
        data: {
          shareToken: null,
          sharedAt: null,
        },
      });

      await invalidateUserChatSessionsCache(user.id);
      return jsonSuccess({ revoked: true, count: result.count }, { requestId });
    }

    if (!token) {
      return jsonSuccess({ revoked: false, message: "Token share diperlukan" }, { requestId });
    }

    const result = await db.chatSession.updateMany({
      where: {
        userId: user.id,
        shareToken: token,
      },
      data: {
        shareToken: null,
        sharedAt: null,
      },
    });

    await invalidateUserChatSessionsCache(user.id);
    return jsonSuccess({ revoked: true, count: result.count }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
