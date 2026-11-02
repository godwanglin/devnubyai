import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { incrementRateCounter } from "@/lib/api/rate-limit";

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

async function assertWithinLimit(userId: bigint): Promise<void> {
  const count = await incrementRateCounter(`rate:user-lookup:${userId}`, WINDOW_SECONDS);
  if (count > LOOKUPS_PER_WINDOW) {
    throw ApiError.rateLimited("Too many lookups, try again in a minute");
  }
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
