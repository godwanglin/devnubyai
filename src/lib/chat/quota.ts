import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";

export interface QuotaCheckResult {
  periodStart: Date;
  monthlyLimit: number | null;
  usedTokens: number;
  remainingTokens: number | null;
  requestCount: number;
  dailyRequestLimit: number | null;
}

/**
 * Returns UTC Date for the 1st of the current month (start of current usage period).
 */
export function getCurrentPeriodStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Verify user's monthly quota and daily request limit against their current Plan.
 * Throws ApiError.rateLimited if limits are exceeded.
 */
export async function assertUserQuota(userId: bigint): Promise<QuotaCheckResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      plan: {
        select: {
          slug: true,
          monthlyTokenLimit: true,
          dailyRequestLimit: true,
          requestsPerMinute: true,
        },
      },
    },
  });

  if (!user) {
    throw ApiError.unauthorized("User account not found");
  }

  const periodStart = getCurrentPeriodStart();
  const usagePeriod = await db.userUsagePeriod.findUnique({
    where: {
      userId_periodStart: {
        userId,
        periodStart,
      },
    },
  });

  const rawTokenLimit = user.plan?.monthlyTokenLimit;
  const monthlyLimit =
    rawTokenLimit != null && rawTokenLimit > 0n ? Number(rawTokenLimit) : null;

  const usedTokens = usagePeriod
    ? Number(usagePeriod.promptTokens + usagePeriod.completionTokens)
    : 0;

  if (monthlyLimit !== null && usedTokens >= monthlyLimit) {
    throw ApiError.rateLimited(
      `Monthly token quota exceeded (${usedTokens.toLocaleString()} / ${monthlyLimit.toLocaleString()} tokens). Upgrade your plan or wait until next month.`
    );
  }

  const dailyLimit = user.plan?.dailyRequestLimit ?? null;
  const rpmLimit = user.plan?.requestsPerMinute ?? null;
  const now = new Date();

  // Enforce requests per minute (sliding 60 seconds across user messages)
  if (rpmLimit !== null && rpmLimit > 0) {
    const oneMinuteAgo = new Date(now.getTime() - 60_000);
    const recentCount = await db.chatMessage.count({
      where: {
        role: "user",
        createdAt: { gte: oneMinuteAgo },
        session: { userId },
      },
    });
    if (recentCount >= rpmLimit) {
      throw ApiError.rateLimited(
        `Rate limit exceeded (${recentCount}/${rpmLimit} requests per minute). Please slow down.`
      );
    }
  }

  // Enforce daily request limit (since midnight UTC)
  if (dailyLimit !== null && dailyLimit > 0) {
    const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dailyCount = await db.chatMessage.count({
      where: {
        role: "user",
        createdAt: { gte: startOfTodayUtc },
        session: { userId },
      },
    });
    if (dailyCount >= dailyLimit) {
      throw ApiError.rateLimited(
        `Daily request limit reached (${dailyCount}/${dailyLimit} requests today). Try again tomorrow or upgrade your plan.`
      );
    }
  }

  const requestCount = usagePeriod?.requestCount ?? 0;

  return {
    periodStart,
    monthlyLimit,
    usedTokens,
    remainingTokens: monthlyLimit !== null ? Math.max(0, monthlyLimit - usedTokens) : null,
    requestCount,
    dailyRequestLimit: dailyLimit,
  };
}

/**
 * Record token and request usage atomically for the user's current billing period.
 */
export async function recordUserUsage(
  userId: bigint,
  tokens: { promptTokens: number; completionTokens: number }
): Promise<void> {
  const periodStart = getCurrentPeriodStart();
  const prompt = BigInt(Math.max(0, Math.floor(tokens.promptTokens)));
  const completion = BigInt(Math.max(0, Math.floor(tokens.completionTokens)));

  await db.userUsagePeriod.upsert({
    where: {
      userId_periodStart: {
        userId,
        periodStart,
      },
    },
    update: {
      requestCount: { increment: 1 },
      promptTokens: { increment: prompt },
      completionTokens: { increment: completion },
    },
    create: {
      userId,
      periodStart,
      requestCount: 1,
      promptTokens: prompt,
      completionTokens: completion,
    },
  });
}
