import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { getCachedJson, setCachedJson } from "@/lib/redis/client";
import {
  CACHE_KEYS,
  CACHE_TTL,
  invalidateUserQuotaCache,
} from "@/lib/redis/cache-keys";
import type { QuotaKind, QuotaNotice } from "./quota-shared";

export interface QuotaCheckResult {
  periodStart: Date;
  monthlyLimit: number | null;
  usedTokens: number;
  remainingTokens: number | null;
  requestCount: number;
  dailyRequestLimit: number | null;
  weeklyLimit: number | null;
  weeklyUsedTokens: number;
  weeklyRemainingTokens: number | null;
  fiveHourLimit: number | null;
  fiveHourUsedTokens: number;
  fiveHourRemainingTokens: number | null;
}

export function getCurrentPeriodStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function getNextPeriodStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function quotaDetails(kind: QuotaKind, used: number, limit: number, resetAt: Date) {
  const quota: QuotaNotice = { kind, used, limit, resetAt: resetAt.toISOString() };
  return { quota };
}

function getUtcWeekStart(now: Date): Date {
  const day = now.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

function toSafeNumber(value: bigint): number {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) ? numberValue : Number.MAX_SAFE_INTEGER;
}

function positiveLimit(value: bigint | null | undefined): number | null {
  if (value == null || value <= 0n) return null;
  return toSafeNumber(value);
}

function usedTokens(period: { promptTokens: bigint; completionTokens: bigint } | null): number {
  return period ? toSafeNumber(period.promptTokens + period.completionTokens) : 0;
}

export interface QuotaWindowStatus {
  /** null when the plan sets 0/empty: tokens are still counted but never blocked */
  limitTokens: number | null;
  usedTokens: number;
  usedPercent: number;
  resetAt: string;
}

export interface UserQuotaWindows {
  fiveHour: QuotaWindowStatus;
  weekly: QuotaWindowStatus;
  monthly: QuotaWindowStatus & { requestCount: number; promptTokens: number; completionTokens: number };
}

function windowStatus(used: number, limit: number | null, resetAt: Date): QuotaWindowStatus {
  return {
    limitTokens: limit,
    usedTokens: used,
    usedPercent: limit ? Math.min(100, Math.round((used / limit) * 100)) : 0,
    resetAt: resetAt.toISOString(),
  };
}

/** Read-only usage for every window, for display (no limits are enforced here). */
export async function getUserQuotaWindows(
  userId: bigint,
  plan: { monthlyTokenLimit: bigint | null; weeklyTokenLimit: bigint | null; fiveHourTokenLimit: bigint | null } | null
): Promise<UserQuotaWindows> {
  const cached = await getCachedJson<UserQuotaWindows>(CACHE_KEYS.userQuota(userId));
  if (cached) {
    return cached;
  }

  const now = new Date();
  const periodStart = getCurrentPeriodStart(now);
  const weekStart = getUtcWeekStart(now);
  const fiveHourStart = new Date(Math.floor(now.getTime() / 18_000_000) * 18_000_000);

  const [monthly, weekly, fiveHour] = await Promise.all([
    db.userUsagePeriod.findUnique({ where: { userId_periodStart: { userId, periodStart } } }),
    db.userUsageWindow.findUnique({
      where: { userId_windowType_windowKey: { userId, windowType: "weekly", windowKey: weekStart.toISOString() } },
    }),
    db.userUsageWindow.findUnique({
      where: { userId_windowType_windowKey: { userId, windowType: "five_hour", windowKey: fiveHourStart.toISOString() } },
    }),
  ]);

  const result: UserQuotaWindows = {
    fiveHour: windowStatus(
      usedTokens(fiveHour),
      positiveLimit(plan?.fiveHourTokenLimit),
      new Date(fiveHourStart.getTime() + 18_000_000)
    ),
    weekly: windowStatus(
      usedTokens(weekly),
      positiveLimit(plan?.weeklyTokenLimit),
      new Date(weekStart.getTime() + 7 * 86_400_000)
    ),
    monthly: {
      ...windowStatus(usedTokens(monthly), positiveLimit(plan?.monthlyTokenLimit), getNextPeriodStart(now)),
      requestCount: monthly?.requestCount ?? 0,
      promptTokens: monthly ? toSafeNumber(monthly.promptTokens) : 0,
      completionTokens: monthly ? toSafeNumber(monthly.completionTokens) : 0,
    },
  };

  await setCachedJson(CACHE_KEYS.userQuota(userId), result, CACHE_TTL.USER_QUOTA);

  return result;
}

/** Verify monthly, weekly, five-hour, RPM, and daily request limits. */
export async function assertUserQuota(userId: bigint): Promise<QuotaCheckResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      plan: {
        select: {
          monthlyTokenLimit: true,
          weeklyTokenLimit: true,
          fiveHourTokenLimit: true,
          dailyRequestLimit: true,
          requestsPerMinute: true,
        },
      },
    },
  });

  if (!user) throw ApiError.unauthorized("User account not found");

  const now = new Date();
  const periodStart = getCurrentPeriodStart(now);
  const weekStart = getUtcWeekStart(now);
  const fiveHourStart = new Date(Math.floor(now.getTime() / 18_000_000) * 18_000_000);
  const fiveHourEnd = new Date(fiveHourStart.getTime() + 18_000_000);

  const [monthly, weekly, fiveHour] = await Promise.all([
    db.userUsagePeriod.findUnique({ where: { userId_periodStart: { userId, periodStart } } }),
    db.userUsageWindow.findUnique({
      where: { userId_windowType_windowKey: { userId, windowType: "weekly", windowKey: weekStart.toISOString() } },
    }),
    db.userUsageWindow.findUnique({
      where: { userId_windowType_windowKey: { userId, windowType: "five_hour", windowKey: fiveHourStart.toISOString() } },
    }),
  ]);

  const monthlyLimit = positiveLimit(user.plan?.monthlyTokenLimit);
  const weeklyLimit = positiveLimit(user.plan?.weeklyTokenLimit);
  const fiveHourLimit = positiveLimit(user.plan?.fiveHourTokenLimit);
  const monthlyUsed = usedTokens(monthly);
  const weeklyUsed = usedTokens(weekly);
  const fiveHourUsed = usedTokens(fiveHour);

  if (monthlyLimit !== null && monthlyUsed >= monthlyLimit) {
    throw ApiError.rateLimited(
      `Monthly token quota exceeded (${monthlyUsed.toLocaleString()} / ${monthlyLimit.toLocaleString()} tokens). Upgrade your plan or wait until next month.`,
      quotaDetails("monthly_tokens", monthlyUsed, monthlyLimit, getNextPeriodStart(now))
    );
  }
  if (weeklyLimit !== null && weeklyUsed >= weeklyLimit) {
    throw ApiError.rateLimited(
      `Weekly token quota exceeded (${weeklyUsed.toLocaleString()} / ${weeklyLimit.toLocaleString()} tokens).`,
      quotaDetails("weekly_tokens", weeklyUsed, weeklyLimit, new Date(weekStart.getTime() + 7 * 86_400_000))
    );
  }
  if (fiveHourLimit !== null && fiveHourUsed >= fiveHourLimit) {
    throw ApiError.rateLimited(
      `Five-hour token quota exceeded (${fiveHourUsed.toLocaleString()} / ${fiveHourLimit.toLocaleString()} tokens).`,
      quotaDetails("five_hour_tokens", fiveHourUsed, fiveHourLimit, fiveHourEnd)
    );
  }

  const rpmLimit = user.plan?.requestsPerMinute ?? null;
  if (rpmLimit !== null && rpmLimit > 0) {
    const oneMinuteAgo = new Date(now.getTime() - 60_000);
    const recentCount = await db.chatMessage.count({
      where: { role: "user", createdAt: { gte: oneMinuteAgo }, session: { userId } },
    });
    if (recentCount >= rpmLimit) {
      const oldest = await db.chatMessage.findFirst({
        where: { role: "user", createdAt: { gte: oneMinuteAgo }, session: { userId } },
        orderBy: { createdAt: "asc" }, select: { createdAt: true },
      });
      throw ApiError.rateLimited(
        `Rate limit exceeded (${recentCount}/${rpmLimit} requests per minute). Please slow down.`,
        quotaDetails("rate_per_minute", recentCount, rpmLimit, new Date((oldest?.createdAt ?? now).getTime() + 60_000))
      );
    }
  }

  const dailyLimit = user.plan?.dailyRequestLimit ?? null;
  if (dailyLimit !== null && dailyLimit > 0) {
    const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dailyCount = await db.chatMessage.count({
      where: { role: "user", createdAt: { gte: startOfTodayUtc }, session: { userId } },
    });
    if (dailyCount >= dailyLimit) {
      throw ApiError.rateLimited(
        `Daily request limit reached (${dailyCount}/${dailyLimit} requests today). Try again tomorrow or upgrade your plan.`,
        quotaDetails("daily_requests", dailyCount, dailyLimit, new Date(startOfTodayUtc.getTime() + 86_400_000))
      );
    }
  }

  return {
    periodStart,
    monthlyLimit,
    usedTokens: monthlyUsed,
    remainingTokens: monthlyLimit === null ? null : Math.max(0, monthlyLimit - monthlyUsed),
    requestCount: monthly?.requestCount ?? 0,
    dailyRequestLimit: dailyLimit,
    weeklyLimit,
    weeklyUsedTokens: weeklyUsed,
    weeklyRemainingTokens: weeklyLimit === null ? null : Math.max(0, weeklyLimit - weeklyUsed),
    fiveHourLimit,
    fiveHourUsedTokens: fiveHourUsed,
    fiveHourRemainingTokens: fiveHourLimit === null ? null : Math.max(0, fiveHourLimit - fiveHourUsed),
  };
}

/** Record token and request usage for monthly, weekly, and five-hour windows. */
export async function recordUserUsage(
  userId: bigint,
  tokens: { promptTokens: number; completionTokens: number }
): Promise<void> {
  const now = new Date();
  const prompt = BigInt(Math.max(0, Math.floor(tokens.promptTokens)));
  const completion = BigInt(Math.max(0, Math.floor(tokens.completionTokens)));
  const total = prompt + completion;
  const periodStart = getCurrentPeriodStart(now);
  const weekStart = getUtcWeekStart(now);
  const fiveHourStart = new Date(Math.floor(now.getTime() / 18_000_000) * 18_000_000);
  const fiveHourEnd = new Date(fiveHourStart.getTime() + 18_000_000);

  await db.$transaction([
    db.userUsagePeriod.upsert({
      where: { userId_periodStart: { userId, periodStart } },
      update: { requestCount: { increment: 1 }, promptTokens: { increment: prompt }, completionTokens: { increment: completion } },
      create: { userId, periodStart, requestCount: 1, promptTokens: prompt, completionTokens: completion },
    }),
    db.userUsageWindow.upsert({
      where: { userId_windowType_windowKey: { userId, windowType: "weekly", windowKey: weekStart.toISOString() } },
      update: { requestCount: { increment: 1 }, promptTokens: { increment: prompt }, completionTokens: { increment: completion } },
      create: { userId, windowType: "weekly", windowKey: weekStart.toISOString(), windowStart: weekStart, windowEnd: new Date(weekStart.getTime() + 7 * 86_400_000), requestCount: 1, promptTokens: prompt, completionTokens: completion },
    }),
    db.userUsageWindow.upsert({
      where: { userId_windowType_windowKey: { userId, windowType: "five_hour", windowKey: fiveHourStart.toISOString() } },
      update: { requestCount: { increment: 1 }, promptTokens: { increment: prompt }, completionTokens: { increment: completion } },
      create: { userId, windowType: "five_hour", windowKey: fiveHourStart.toISOString(), windowStart: fiveHourStart, windowEnd: fiveHourEnd, requestCount: 1, promptTokens: prompt, completionTokens: completion },
    }),
  ]);
  await invalidateUserQuotaCache(userId);
  void total;
}
