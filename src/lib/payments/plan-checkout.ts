import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { applyPlanDiscount, isPlanDiscountType } from "@/lib/plans/pricing";
import type { BillingCycle } from "@/lib/plans/effective-plan";

export interface PlanCheckout {
  planId: bigint;
  cycle: BillingCycle;
  /** Server-computed price in IDR, after the plan's discount for the cycle */
  amount: number;
  itemName: string;
  /** Persisted on the transaction; read back when the payment settles */
  metadata: { planId: string; cycle: BillingCycle };
}

/**
 * Resolves the plan a checkout pays for and its price on the server.
 * The client's `amount` is never trusted: it must equal this price.
 */
export async function resolvePlanCheckout(
  metadata: Record<string, unknown> | undefined,
  clientAmount: number
): Promise<PlanCheckout> {
  const rawPlanId = metadata?.planId;
  const cycle = metadata?.cycle;

  if (
    (typeof rawPlanId !== "string" && typeof rawPlanId !== "number") ||
    !/^\d{1,19}$/.test(String(rawPlanId))
  ) {
    throw ApiError.badRequest("A valid plan is required");
  }
  if (cycle !== "monthly" && cycle !== "yearly") {
    throw ApiError.badRequest("A valid billing cycle is required");
  }

  const plan = await db.plan.findFirst({
    where: { id: BigInt(String(rawPlanId)), isActive: true },
    select: {
      id: true,
      name: true,
      priceMonthly: true,
      priceYearly: true,
      discountMonthlyType: true,
      discountMonthlyValue: true,
      discountYearlyType: true,
      discountYearlyValue: true,
    },
  });
  if (!plan) {
    throw ApiError.badRequest("Plan is not available");
  }

  const amount =
    cycle === "monthly"
      ? applyPlanDiscount(plan.priceMonthly, {
          discountType: isPlanDiscountType(plan.discountMonthlyType) ? plan.discountMonthlyType : null,
          discountValue: plan.discountMonthlyValue,
        })
      : applyPlanDiscount(plan.priceYearly, {
          discountType: isPlanDiscountType(plan.discountYearlyType) ? plan.discountYearlyType : null,
          discountValue: plan.discountYearlyValue,
        });

  if (amount <= 0) {
    throw ApiError.badRequest("Plan does not require payment");
  }
  if (clientAmount !== amount) {
    throw ApiError.badRequest("Plan price has changed, please refresh and try again");
  }

  return {
    planId: plan.id,
    cycle,
    amount,
    itemName: `${plan.name} (${cycle === "monthly" ? "Bulanan" : "Tahunan"})`,
    metadata: { planId: plan.id.toString(), cycle },
  };
}
