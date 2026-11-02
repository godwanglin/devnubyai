import { db } from "@/lib/db";
import { Prisma } from "@/generated/client";
import { ApiError } from "@/lib/api/response";
import { getCachedJson, setCachedJson } from "@/lib/redis/client";
import {
  CACHE_KEYS,
  CACHE_TTL,
  invalidateUserQuotaCache,
} from "@/lib/redis/cache-keys";
import { computeCostUsd, costLimit, toUsd } from "@/lib/billing/cost";
import { FREE_PLAN_SLUG, isPlanExpired } from "@/lib/plans/effective-plan";
import { effectiveParallelLimit } from "./concurrency";
import type { QuotaKind, QuotaNotice } from "./quota-shared";

/**
 * Quota is spend-based (USD). Every reply adds its cost to the five-hour, weekly
 * and monthly windows at once, so spending inside a short window also eats into
 * the longer ones: monthly is the budget, weekly / five-hour cap the pace.
 */

export interface QuotaCheckResult {
  periodStart: Date;
  monthlyLimitUsd: number | null;
  monthlyUsedUsd: number;
  weeklyLimitUsd: number | null;
  weeklyUsedUsd: number;
  fiveHourLimitUsd: number | null;
  fiveHourUsedUsd: number;
  requestCount: number;
  dailyRequestLimit: number | null;
  /** Concurrent generations allowed by the effective plan */
  maxParallelRequests: number;
}

type PlanCostLimits = {
  monthlyCostLimitUsd: Prisma.Decimal | null;
  weeklyCostLimitUsd: Prisma.Decimal | null;
  fiveHourCostLimitUsd: Prisma.Decimal | null;
};

const FIVE_HOURS_MS = 18_000_000;
const WEEK_MS = 7 * 86_400_000;

export function getCurrentPeriodStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function getNextPeriodStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function getUtcWeekStart(now: Date): Date {
  const day = now.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

function getFiveHourStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / FIVE_HOURS_MS) * FIVE_HOURS_MS);
}

function quotaDetails(kind: QuotaKind, used: number, limit: number, resetAt: Date) {
  const quota: QuotaNotice = { kind, used, limit, resetAt: resetAt.toISOString() };
  return { quota };
}

/** Current usage rows of the three windows. */
async function loadWindows(userId: bigint, now: Date) {
  const periodStart = getCurrentPeriodStart(now);
  const weekStart = getUtcWeekStart(now);
  const fiveHourStart = getFiveHourStart(now);

  const [monthly, weekly, fiveHour] = await Promise.all([
    db.userUsagePeriod.findUnique({ where: { userId_periodStart: { userId, periodStart } } }),
    db.userUsageWindow.findUnique({
      where: { userId_windowType_windowKey: { userId, windowType: "weekly", windowKey: weekStart.toISOString() } },
    }),
    db.userUsageWindow.findUnique({
      where: { userId_windowType_windowKey: { userId, windowType: "five_hour", windowKey: fiveHourStart.toISOString() } },
    }),
  ]);

  return {
    periodStart,
    monthly,
    weekly,
    fiveHour,
    resets: {
      monthly: getNextPeriodStart(now),
      weekly: new Date(weekStart.getTime() + WEEK_MS),
      fiveHour: new Date(fiveHourStart.getTime() + FIVE_HOURS_MS),
    },
  };
}

export interface QuotaWindowStatus {
  /** null when the plan sets 0/empty: spend is still counted but never blocked */
  limitUsd: number | null;
  usedUsd: number;
  usedPercent: number;
  resetAt: string;
}

export interface UserQuotaWindows {
  fiveHour: QuotaWindowStatus;
  weekly: QuotaWindowStatus;
  monthly: QuotaWindowStatus & { requestCount: number };
}

function windowStatus(used: number, limit: number | null, resetAt: Date): QuotaWindowStatus {
  return {
    limitUsd: limit,
    usedUsd: used,
    usedPercent: limit ? Math.min(100, Math.round((used / limit) * 100)) : 0,
    resetAt: resetAt.toISOString(),
  };
}

/** Read-only spend for every window, for display (no limits are enforced here). */
export async function getUserQuotaWindows(
  userId: bigint,
  plan: PlanCostLimits | null
): Promise<UserQuotaWindows> {
  const cached = await getCachedJson<UserQuotaWindows>(CACHE_KEYS.userQuota(userId));
  if (cached) {
    return cached;
  }

  const w = await loadWindows(userId, new Date());

  const result: UserQuotaWindows = {
    fiveHour: windowStatus(toUsd(w.fiveHour?.costUsd), costLimit(plan?.fiveHourCostLimitUsd), w.resets.fiveHour),
    weekly: windowStatus(toUsd(w.weekly?.costUsd), costLimit(plan?.weeklyCostLimitUsd), w.resets.weekly),
    monthly: {
      ...windowStatus(toUsd(w.monthly?.costUsd), costLimit(plan?.monthlyCostLimitUsd), w.resets.monthly),
      requestCount: w.monthly?.requestCount ?? 0,
    },
  };

  await setCachedJson(CACHE_KEYS.userQuota(userId), result, CACHE_TTL.USER_QUOTA);

  return result;
}

/** Verify monthly, weekly, five-hour spend plus RPM and daily request limits. */
export async function assertUserQuota(userId: bigint): Promise<QuotaCheckResult> {
  const planLimitsSelect = {
    monthlyCostLimitUsd: true,
    weeklyCostLimitUsd: true,
    fiveHourCostLimitUsd: true,
    dailyRequestLimit: true,
    requestsPerMinute: true,
    maxParallelRequests: true,
  } as const;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, planExpiresAt: true, plan: { select: planLimitsSelect } },
  });

  if (!user) throw ApiError.unauthorized("User account not found");
  // An expired paid plan is held to the free plan's limits
  if (isPlanExpired(user.planExpiresAt)) {
    user.plan = await db.plan.findUnique({ where: { slug: FREE_PLAN_SLUG }, select: planLimitsSelect });
  }

  const now = new Date();
  const w = await loadWindows(userId, now);

  const monthlyLimit = costLimit(user.plan?.monthlyCostLimitUsd);
  const weeklyLimit = costLimit(user.plan?.weeklyCostLimitUsd);
  const fiveHourLimit = costLimit(user.plan?.fiveHourCostLimitUsd);
  const monthlyUsed = toUsd(w.monthly?.costUsd);
  const weeklyUsed = toUsd(w.weekly?.costUsd);
  const fiveHourUsed = toUsd(w.fiveHour?.costUsd);

  const usd = (n: number) => `$${n.toFixed(2)}`;

  if (monthlyLimit !== null && monthlyUsed >= monthlyLimit) {
    throw ApiError.rateLimited(
      `Monthly usage limit reached (${usd(monthlyUsed)} / ${usd(monthlyLimit)}). Upgrade your plan or wait until next month.`,
      quotaDetails("monthly_cost", monthlyUsed, monthlyLimit, w.resets.monthly)
    );
  }
  if (weeklyLimit !== null && weeklyUsed >= weeklyLimit) {
    throw ApiError.rateLimited(
      `Weekly usage limit reached (${usd(weeklyUsed)} / ${usd(weeklyLimit)}).`,
      quotaDetails("weekly_cost", weeklyUsed, weeklyLimit, w.resets.weekly)
    );
  }
  if (fiveHourLimit !== null && fiveHourUsed >= fiveHourLimit) {
    throw ApiError.rateLimited(
      `Five-hour usage limit reached (${usd(fiveHourUsed)} / ${usd(fiveHourLimit)}).`,
      quotaDetails("five_hour_cost", fiveHourUsed, fiveHourLimit, w.resets.fiveHour)
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
    periodStart: w.periodStart,
    monthlyLimitUsd: monthlyLimit,
    monthlyUsedUsd: monthlyUsed,
    weeklyLimitUsd: weeklyLimit,
    weeklyUsedUsd: weeklyUsed,
    fiveHourLimitUsd: fiveHourLimit,
    fiveHourUsedUsd: fiveHourUsed,
    requestCount: w.monthly?.requestCount ?? 0,
    dailyRequestLimit: dailyLimit,
    maxParallelRequests: effectiveParallelLimit(user.plan?.maxParallelRequests),
  };
}

export interface RecordUsageInput {
  promptTokens: number;
  completionTokens: number;
  model: {
    id: bigint;
    inputPricePerMillion: Prisma.Decimal;
    outputPricePerMillion: Prisma.Decimal;
  };
  sessionId?: bigint | null;
  messageId?: bigint | null;
  requestId?: string | null;
}

/**
 * Prices one reply from the model's catalog rates, logs it in `usage_logs` and
 * adds the cost (plus token counts, for reference) to all three windows.
 */
export async function recordUserUsage(userId: bigint, input: RecordUsageInput): Promise<void> {
  const now = new Date();
  const promptTokens = Math.max(0, Math.floor(input.promptTokens));
  const completionTokens = Math.max(0, Math.floor(input.completionTokens));
  const prompt = BigInt(promptTokens);
  const completion = BigInt(completionTokens);
  const cost = computeCostUsd(
    promptTokens,
    completionTokens,
    input.model.inputPricePerMillion,
    input.model.outputPricePerMillion
  );

  const periodStart = getCurrentPeriodStart(now);
  const weekStart = getUtcWeekStart(now);
  const fiveHourStart = getFiveHourStart(now);
  const increment = {
    requestCount: { increment: 1 },
    promptTokens: { increment: prompt },
    completionTokens: { increment: completion },
    costUsd: { increment: cost },
  };
  const initial = { requestCount: 1, promptTokens: prompt, completionTokens: completion, costUsd: cost };

  await db.$transaction([
    db.usageLog.create({
      data: {
        userId,
        sessionId: input.sessionId ?? null,
        messageId: input.messageId ?? null,
        catalogModelId: input.model.id,
        requestId: input.requestId ?? null,
        promptTokens,
        completionTokens,
        inputPricePerMillion: input.model.inputPricePerMillion,
        outputPricePerMillion: input.model.outputPricePerMillion,
        costUsd: cost,
      },
    }),
    db.userUsagePeriod.upsert({
      where: { userId_periodStart: { userId, periodStart } },
      update: increment,
      create: { userId, periodStart, ...initial },
    }),
    db.userUsageWindow.upsert({
      where: { userId_windowType_windowKey: { userId, windowType: "weekly", windowKey: weekStart.toISOString() } },
      update: increment,
      create: { userId, windowType: "weekly", windowKey: weekStart.toISOString(), windowStart: weekStart, windowEnd: new Date(weekStart.getTime() + WEEK_MS), ...initial },
    }),
    db.userUsageWindow.upsert({
      where: { userId_windowType_windowKey: { userId, windowType: "five_hour", windowKey: fiveHourStart.toISOString() } },
      update: increment,
      create: { userId, windowType: "five_hour", windowKey: fiveHourStart.toISOString(), windowStart: fiveHourStart, windowEnd: new Date(fiveHourStart.getTime() + FIVE_HOURS_MS), ...initial },
    }),
  ]);
  await invalidateUserQuotaCache(userId);
}

/**
 * Bills a stream that stopped or failed after producing output, so aborting
 * mid-generation is not free. Providers often report usage only at the end,
 * so missing counts fall back to a ~4 chars/token estimate. Never throws.
 */
export async function recordPartialUsage(
  userId: bigint,
  input: RecordUsageInput & { generatedChars: number; promptChars: () => number }
): Promise<void> {
  const { generatedChars, promptChars, ...usage } = input;
  if (usage.promptTokens <= 0 && usage.completionTokens <= 0 && generatedChars <= 0) return;
  await recordUserUsage(userId, {
    ...usage,
    promptTokens: usage.promptTokens > 0 ? usage.promptTokens : Math.ceil(promptChars() / 4),
    completionTokens: Math.max(usage.completionTokens, Math.ceil(generatedChars / 4)),
  }).catch((err) => {
    console.error("[USAGE_RECORD_ERROR]", err);
  });
}
