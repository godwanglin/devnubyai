import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { redis } from "@/lib/redis/client";

/**
 * Resolves one exact email to a registered user's display name / avatar, for
 * invite suggestions (e.g. sharing a project). Exact match only, never prefix
 * search, plus a per-user rate limit so it can't be used to enumerate accounts.
 */
const LOOKUPS_PER_WINDOW = 30;
const WINDOW_SECONDS = 60;

const querySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
});

const localCounters = new Map<string, { count: number; resetAt: number }>();

async function assertWithinLimit(userId: bigint): Promise<void> {
  const key = `rate:user-lookup:${userId}`;
  let count: number;

  const client = redis;
  if (client) {
    try {
      count = await client.incr(key);
      if (count === 1) await client.expire(key, WINDOW_SECONDS);
    } catch {
      count = bumpLocal(key);
    }
  } else {
    count = bumpLocal(key);
  }

  if (count > LOOKUPS_PER_WINDOW) {
    throw ApiError.rateLimited("Too many lookups, try again in a minute");
  }
}

function bumpLocal(key: string): number {
  const now = Date.now();
  const entry = localCounters.get(key);
  if (!entry || entry.resetAt <= now) {
    localCounters.set(key, { count: 1, resetAt: now + WINDOW_SECONDS * 1000 });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const parsed = querySchema.safeParse({
      email: new URL(request.url).searchParams.get("email") ?? "",
    });
    if (!parsed.success) {
      throw ApiError.badRequest("A valid email is required");
    }

    await assertWithinLimit(user.id);

    const found = await db.user.findUnique({
      where: { email: parsed.data.email },
      select: { name: true, email: true, avatarUrl: true, status: true },
    });

    // Deactivated accounts look the same as unknown ones
    const match =
      found && found.status === "active"
        ? { name: found.name, email: found.email, avatarUrl: found.avatarUrl }
        : null;

    return jsonSuccess({ user: match }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
