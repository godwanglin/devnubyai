import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const session = await getSession();

    // If user is not logged in, return null data so client can gracefully show guest/login state
    if (!session) {
      return jsonSuccess({ user: null }, { requestId });
    }

    const { user } = session;

    // Calculate current monthly quota usage
    // Period starts on the 1st of the current month
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    // Next month 1st for reset calculation
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const msUntilReset = nextMonth.getTime() - now.getTime();
    const resetInDays = Math.max(1, Math.ceil(msUntilReset / (1000 * 60 * 60 * 24)));

    const usagePeriod = await db.userUsagePeriod.findUnique({
      where: {
        userId_periodStart: {
          userId: user.id,
          periodStart,
        },
      },
    });

    // null limit (or no plan) means unlimited; limits come from the plans table only
    const rawLimit = user.plan?.monthlyTokenLimit;
    const monthlyLimit = rawLimit != null && rawLimit > BigInt(0) ? Number(rawLimit) : null;

    const usedTokens = usagePeriod
      ? Number(usagePeriod.promptTokens + usagePeriod.completionTokens)
      : 0;

    const usedPercent = monthlyLimit
      ? Math.min(100, Math.round((usedTokens / monthlyLimit) * 100))
      : 0;

    // Compute initials (e.g., "Aiden Lin" -> "AL")
    const initials = user.name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || "")
      .join("") || "U";

    const responsePayload = {
      user: {
        id: user.publicId,
        name: user.name,
        email: user.email,
        initials,
        role: user.role,
        plan: user.plan?.slug ?? "free",
        planLabel: user.plan?.name ?? "Free Plan",
        avatarUrl: user.avatarUrl,
        quota: {
          usedPercent,
          usedTokens,
          limitTokens: monthlyLimit,
          resetInDays,
          requestCount: usagePeriod?.requestCount ?? 0,
        },
      },
    };

    return jsonSuccess(responsePayload, { requestId });
  } catch (err) {
    console.error(`[ME_ERROR] [${requestId}]`, err);
    return jsonError(err, { requestId });
  }
}
