import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getCachedJson, setCachedJson } from "@/lib/redis/client";
import {
  CACHE_KEYS,
  CACHE_TTL,
  invalidateUserSessionsCache,
} from "@/lib/redis/cache-keys";

interface RawSessionItem {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const ctx = await requireSession();

    let rawSessions = await getCachedJson<RawSessionItem[]>(
      CACHE_KEYS.userSessions(ctx.user.id)
    );

    if (!rawSessions) {
      const sessions = await db.authSession.findMany({
        where: {
          userId: ctx.user.id,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });

      rawSessions = sessions.map((s) => ({
        id: s.id.toString(),
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      }));

      await setCachedJson(
        CACHE_KEYS.userSessions(ctx.user.id),
        rawSessions,
        CACHE_TTL.USER_SESSIONS
      );
    }

    const currentSessionIdStr = ctx.sessionId.toString();
    const mapped = rawSessions.map((s) => ({
      ...s,
      isCurrent: s.id === currentSessionIdStr,
    }));

    return jsonSuccess({ sessions: mapped }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);

  try {
    const ctx = await requireSession();
    const url = new URL(request.url);
    const targetSessionId = url.searchParams.get("sessionId");

    if (targetSessionId) {
      // Revoke a specific session if it belongs to user and is NOT current
      if (!/^\d{1,19}$/.test(targetSessionId)) {
        throw ApiError.badRequest("Invalid sessionId");
      }
      const sId = BigInt(targetSessionId);
      if (sId === ctx.sessionId) {
        return jsonSuccess({ revoked: false, message: "Cannot revoke current session via this method" }, { requestId });
      }

      await db.authSession.deleteMany({
        where: {
          id: sId,
          userId: ctx.user.id,
        },
      });

      await invalidateUserSessionsCache(ctx.user.id);

      return jsonSuccess({ revoked: true, count: 1 }, { requestId });
    }

    // Otherwise revoke ALL other sessions except the current one
    const result = await db.authSession.deleteMany({
      where: {
        userId: ctx.user.id,
        id: { not: ctx.sessionId },
      },
    });

    await invalidateUserSessionsCache(ctx.user.id);

    return jsonSuccess({ revoked: true, count: result.count }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
