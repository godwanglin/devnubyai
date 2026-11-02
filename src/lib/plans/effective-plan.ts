export const FREE_PLAN_SLUG = "free";

export type BillingCycle = "monthly" | "yearly";

/** True once a paid plan's expiry has passed; null means it never expires. */
export function isPlanExpired(planExpiresAt: Date | null | undefined, now = Date.now()): boolean {
  return planExpiresAt != null && planExpiresAt.getTime() <= now;
}

/**
 * Expiry after paying for `newPlanId` for one cycle. Renewing the same, still
 * active plan extends from its current expiry; switching plans starts now.
 * A same-plan purchase on a non-expiring grant keeps it non-expiring.
 */
export function computePlanExpiry(
  current: { planId: bigint | null; planExpiresAt: Date | null },
  newPlanId: bigint,
  cycle: BillingCycle,
  now = new Date()
): Date | null {
  const samePlan = current.planId === newPlanId;
  if (samePlan && current.planExpiresAt === null) return null;

  const base =
    samePlan && current.planExpiresAt && current.planExpiresAt > now ? current.planExpiresAt : now;
  const next = new Date(base);
  next.setUTCMonth(next.getUTCMonth() + (cycle === "yearly" ? 12 : 1));
  return next;
}
