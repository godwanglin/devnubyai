import { db } from "@/lib/db";
import { Prisma } from "@/generated/client";
import { ApiError } from "@/lib/api/response";
import { getCachedJson, setCachedJson } from "@/lib/redis/client";
import { CACHE_KEYS, CACHE_TTL } from "@/lib/redis/cache-keys";
import { computeCostUsd, costLimit, toUsd } from "@/lib/billing/cost";
import { FREE_PLAN_SLUG, isPlanExpired } from "@/lib/plans/effective-plan";
import { countActiveGenerations, effectiveParallelLimit } from "./concurrency";
import { chargeLiveLedger, readLiveLedger, type LiveLedger } from "./live-quota";
import {
  DAY_MS,
  getCurrentPeriodStart,
  getFiveHourStart,
  getNextPeriodStart,
  getUtcWeekStart,
  windowResetsAt,
} from "./quota-windows";
import type { QuotaKind, QuotaNotice } from "./quota-shared";

/**
 * Quota is spend-based (USD). Every reply adds its cost to the five-hour, weekly
 * and monthly windows at once, so spending inside a short window also eats into
 * the longer ones: monthly is the budget, weekly / five-hour cap the pace.
 *
 * Enforcement reads the Redis live ledger (`live-quota.ts`), which is charged the
 * moment a model reports token usage, so a second message sent while the first is
 * still streaming already sees its cost. Postgres is only read when that ledger
 * is cold, and is written once per turn, in the turn's store transaction
 * (`redis-chat-state.ts`).
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

export { getCurrentPeriodStart, getNextPeriodStart };

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
    resets: windowResetsAt(now),
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
  const now = new Date();
  const live = await readLiveLedger(userId, now);
  if (live) {
    return windowsFromLedger(live, plan);
  }

  const cached = await getCachedJson<UserQuotaWindows>(CACHE_KEYS.userQuota(userId));
  if (cached) return cached;

  const w = await loadWindows(userId, now);
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

interface UsageSnapshot {
  periodStart: Date;
  monthlyUsed: number;
  weeklyUsed: number;
  fiveHourUsed: number;
  requestCount: number;
  dailyCount: number;
  rpmCount: number;
  resets: ReturnType<typeof windowResetsAt>;
}

/** Spend + request counts: the live ledger when warm, Postgres otherwise. */
async function loadUsageSnapshot(userId: bigint, now: Date): Promise<UsageSnapshot> {
  const resets = windowResetsAt(now);
  const live = await readLiveLedger(userId, now);
  if (live) {
    return {
      periodStart: new Date(live.month.start),
      monthlyUsed: live.month.usd,
      weeklyUsed: live.week.usd,
      fiveHourUsed: live.fiveHour.usd,
      requestCount: live.month.requests,
      dailyCount: live.day.requests,
      rpmCount: live.recent.length,
      resets,
    };
  }

  const w = await loadWindows(userId, now);
  const dayStart = new Date(now.getTime() - (now.getTime() % DAY_MS));
  const [dailyCount, rpmCount] = await Promise.all([
    db.usageLog.count({ where: { userId, createdAt: { gte: dayStart } } }),
    db.usageLog.count({ where: { userId, createdAt: { gte: new Date(now.getTime() - 60_000) } } }),
  ]);
  return {
    periodStart: w.periodStart,
    monthlyUsed: toUsd(w.monthly?.costUsd),
    weeklyUsed: toUsd(w.weekly?.costUsd),
    fiveHourUsed: toUsd(w.fiveHour?.costUsd),
    requestCount: w.monthly?.requestCount ?? 0,
    dailyCount,
    rpmCount,
    resets,
  };
}

export type PlanLimits = PlanCostLimits & {
  dailyRequestLimit: number | null;
  requestsPerMinute: number | null;
  maxParallelRequests: number | null;
};

const planLimitsSelect = {
  monthlyCostLimitUsd: true,
  weeklyCostLimitUsd: true,
  fiveHourCostLimitUsd: true,
  dailyRequestLimit: true,
  requestsPerMinute: true,
  maxParallelRequests: true,
} as const;

/** Effective plan limits of a user (an expired paid plan is held to the free plan). */
async function loadPlanLimits(userId: bigint): Promise<PlanLimits | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, planExpiresAt: true, plan: { select: planLimitsSelect } },
  });
  if (!user) throw ApiError.unauthorized("User account not found");
  if (isPlanExpired(user.planExpiresAt)) {
    return db.plan.findUnique({ where: { slug: FREE_PLAN_SLUG }, select: planLimitsSelect });
  }
  return user.plan;
}

/**
 * Verify monthly, weekly, five-hour spend plus RPM and daily request limits.
 * Pass `plan` from the session user (already the effective plan) to skip the
 * Postgres lookup; omit it to load the plan here.
 */
export async function assertUserQuota(
  userId: bigint,
  plan?: PlanLimits | null
): Promise<QuotaCheckResult> {
  const user = { plan: plan === undefined ? await loadPlanLimits(userId) : plan };

  const now = new Date();
  const usage = await loadUsageSnapshot(userId, now);

  const monthlyLimit = costLimit(user.plan?.monthlyCostLimitUsd);
  const weeklyLimit = costLimit(user.plan?.weeklyCostLimitUsd);
  const fiveHourLimit = costLimit(user.plan?.fiveHourCostLimitUsd);
  const { monthlyUsed, weeklyUsed, fiveHourUsed } = usage;
  const usd = (n: number) => `$${n.toFixed(2)}`;

  if (monthlyLimit !== null && monthlyUsed >= monthlyLimit) {
    throw ApiError.rateLimited(
      `Monthly usage limit reached (${usd(monthlyUsed)} / ${usd(monthlyLimit)}). Upgrade your plan or wait until next month.`,
      quotaDetails("monthly_cost", monthlyUsed, monthlyLimit, usage.resets.monthly)
    );
  }
  if (weeklyLimit !== null && weeklyUsed >= weeklyLimit) {
    throw ApiError.rateLimited(
      `Weekly usage limit reached (${usd(weeklyUsed)} / ${usd(weeklyLimit)}).`,
      quotaDetails("weekly_cost", weeklyUsed, weeklyLimit, usage.resets.weekly)
    );
  }
  if (fiveHourLimit !== null && fiveHourUsed >= fiveHourLimit) {
    throw ApiError.rateLimited(
      `Five-hour usage limit reached (${usd(fiveHourUsed)} / ${usd(fiveHourLimit)}).`,
      quotaDetails("five_hour_cost", fiveHourUsed, fiveHourLimit, usage.resets.fiveHour)
    );
  }

  // Request limits count every generation (sends and regenerates): finished ones from
  // usage_logs plus the ones still streaming, which have no usage row yet.
  const rpmLimit = user.plan?.requestsPerMinute ?? null;
  const dailyLimitValue = user.plan?.dailyRequestLimit ?? null;
  const activeGenerations =
    (rpmLimit ?? 0) > 0 || (dailyLimitValue ?? 0) > 0 ? await countActiveGenerations(userId) : 0;

  if (rpmLimit !== null && rpmLimit > 0) {
    const recentCount = usage.rpmCount + activeGenerations;
    if (recentCount >= rpmLimit) {
      throw ApiError.rateLimited(
        `Rate limit exceeded (${recentCount}/${rpmLimit} requests per minute). Please slow down.`,
        quotaDetails("rate_per_minute", recentCount, rpmLimit, new Date(now.getTime() + 60_000))
      );
    }
  }

  if (dailyLimitValue !== null && dailyLimitValue > 0) {
    const dailyCount = usage.dailyCount + activeGenerations;
    if (dailyCount >= dailyLimitValue) {
      throw ApiError.rateLimited(
        `Daily request limit reached (${dailyCount}/${dailyLimitValue} requests today). Try again tomorrow or upgrade your plan.`,
        quotaDetails("daily_requests", dailyCount, dailyLimitValue, usage.resets.daily)
      );
    }
  }

  return {
    periodStart: usage.periodStart,
    monthlyLimitUsd: monthlyLimit,
    monthlyUsedUsd: monthlyUsed,
    weeklyLimitUsd: weeklyLimit,
    weeklyUsedUsd: weeklyUsed,
    fiveHourLimitUsd: fiveHourLimit,
    fiveHourUsedUsd: fiveHourUsed,
    requestCount: usage.requestCount,
    dailyRequestLimit: dailyLimitValue,
    maxParallelRequests: effectiveParallelLimit(user.plan?.maxParallelRequests),
  };
}

/**
 * Live (mid-turn) charging. While a reply streams, `chargeLiveUsage` is called
 * with the running token totals; only the growth since the previous call is
 * added to the Redis ledger, so a message sent while this one still streams
 * already sees its cost. `settleLiveUsage` then books the final figures: the
 * request count plus any difference between what was charged live and the
 * final price (e.g. the ~4 chars/token estimate of an aborted stream).
 * Postgres is written separately, once, when the turn is stored.
 */
const liveCharged = new Map<string, number>();

type ModelPrices = { inputPricePerMillion: Prisma.Decimal; outputPricePerMillion: Prisma.Decimal };

function priceOf(promptTokens: number, completionTokens: number, model: ModelPrices): number {
  return Number(
    computeCostUsd(promptTokens, completionTokens, model.inputPricePerMillion, model.outputPricePerMillion)
  );
}

export async function chargeLiveUsage(
  userId: bigint,
  turnId: string,
  promptTokens: number,
  completionTokens: number,
  model: ModelPrices
): Promise<LiveLedger | null> {
  const charged = liveCharged.get(turnId) ?? 0;
  const delta = priceOf(promptTokens, completionTokens, model) - charged;
  if (delta <= 0) return null;
  liveCharged.set(turnId, charged + delta);
  return chargeLiveLedger(userId, delta, 0);
}

/** Final live booking of a turn; `final` is null when the reply is not billed at all. */
export async function settleLiveUsage(
  userId: bigint,
  turnId: string,
  final: { promptTokens: number; completionTokens: number; model: ModelPrices } | null
): Promise<LiveLedger | null> {
  const charged = liveCharged.get(turnId) ?? 0;
  liveCharged.delete(turnId);
  const finalUsd = final ? priceOf(final.promptTokens, final.completionTokens, final.model) : 0;
  return chargeLiveLedger(userId, finalUsd - charged, final ? 1 : 0);
}

/**
 * Billed token figures of a turn. A completed reply bills what the model
 * reported; a stopped or failed one that produced output is still billed, with
 * missing counts estimated at ~4 chars/token, so aborting is not free.
 */
export function finalTurnTokens(input: {
  completed: boolean;
  promptTokens: number;
  completionTokens: number;
  generatedChars: number;
  promptChars: () => number;
}): { promptTokens: number; completionTokens: number } | null {
  if (input.completed) {
    return { promptTokens: input.promptTokens, completionTokens: input.completionTokens };
  }
  if (input.promptTokens <= 0 && input.completionTokens <= 0 && input.generatedChars <= 0) return null;
  return {
    promptTokens: input.promptTokens > 0 ? input.promptTokens : Math.ceil(input.promptChars() / 4),
    completionTokens: Math.max(input.completionTokens, Math.ceil(input.generatedChars / 4)),
  };
}

/** Client quota payload (same shape as `/api/v1/me/quota`) built from windows. */
export function toQuotaPayload(windows: UserQuotaWindows) {
  const msUntilReset = new Date(windows.monthly.resetAt).getTime() - Date.now();
  return {
    usedPercent: windows.monthly.usedPercent,
    usedUsd: windows.monthly.usedUsd,
    limitUsd: windows.monthly.limitUsd,
    resetInDays: Math.max(1, Math.ceil(msUntilReset / DAY_MS)),
    resetAt: windows.monthly.resetAt,
    requestCount: windows.monthly.requestCount,
    windows,
  };
}

/** Windows for display straight from a ledger returned by a live charge. */
export function windowsFromLedger(ledger: LiveLedger, plan: PlanCostLimits | null): UserQuotaWindows {
  const now = new Date();
  const resets = windowResetsAt(now);
  const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
  return {
    fiveHour: windowStatus(round(ledger.fiveHour.usd), costLimit(plan?.fiveHourCostLimitUsd), resets.fiveHour),
    weekly: windowStatus(round(ledger.week.usd), costLimit(plan?.weeklyCostLimitUsd), resets.weekly),
    monthly: {
      ...windowStatus(round(ledger.month.usd), costLimit(plan?.monthlyCostLimitUsd), resets.monthly),
      requestCount: ledger.month.requests,
    },
  };
}

