import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10), 5), 50);
    const cursor = url.searchParams.get("cursor");

    // Total count of user chat sessions
    const totalCount = await db.chatSession.count({
      where: { userId: user.id },
    });

    // Find cursor session id if provided
    let cursorId: bigint | undefined;
    if (cursor) {
      const cursorSession = await db.chatSession.findUnique({
        where: { publicId: cursor, userId: user.id },
        select: { id: true },
      });
      if (cursorSession) {
        cursorId = cursorSession.id;
      }
    }

    const sessions = await db.chatSession.findMany({
      where: {
        userId: user.id,
        // PIN-locked chats are never included in exports
        isLocked: false,
        ...(cursorId ? { id: { lt: cursorId } } : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
      select: {
        id: true,
        publicId: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        isArchived: true,
        isPinned: true,
        messages: {
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
          },
          orderBy: { id: "asc" },
        },
      },
    });

    const hasMore = sessions.length > limit;
    const batch = hasMore ? sessions.slice(0, limit) : sessions;
    const nextCursor = hasMore ? batch[batch.length - 1]?.publicId ?? null : null;

    const mapped = batch.map((s) => ({
      id: s.publicId,
      title: s.title,
      isArchived: s.isArchived,
      isPinned: s.isPinned,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      messages: s.messages.map((m) => ({
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    }));

    return jsonSuccess(
      {
        totalCount,
        conversations: mapped,
        nextCursor,
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
