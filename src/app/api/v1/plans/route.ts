import { db } from "@/lib/db";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { applyPlanDiscount, isPlanDiscountType, type PlanDiscountType } from "@/lib/plans/pricing";
import { getCachedJson, setCachedJson } from "@/lib/redis/client";
import { CACHE_KEYS, CACHE_TTL } from "@/lib/redis/cache-keys";
import { costLimit } from "@/lib/billing/cost";
import { normalizePlanFeatures, type PlanFeature } from "@/lib/plans/features";
import { IMAGE_CATALOG_CATEGORY } from "@/lib/images/settings";

export interface PublicPlanModel {
  id: string;
  publicId: string;
  displayName: string;
  shortName: string;
  category: string;
  badge: string | null;
}

export interface PublicPlanItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  discountMonthlyType: PlanDiscountType | null;
  discountMonthlyValue: number | null;
  discountYearlyType: PlanDiscountType | null;
  discountYearlyValue: number | null;
  effectivePriceMonthly: number;
  effectivePriceYearly: number;
  /**
   * Usage allowance relative to the base plan (lowest monthly limit), e.g. 10 = 10x.
   * Dollar caps stay server-side: users only see how plans compare.
   */
  usage:
    | { kind: "unlimited" }
    | { kind: "base" }
    | { kind: "multiple"; multiplier: number; baseName: string };
  dailyRequestLimit: number | null;
  requestsPerMinute: number | null;
  badge: string | null;
  sortOrder: number;
  /** Admin-managed "Capacity & Quotas" rows, in display order */
  features: PlanFeature[];
  models: PublicPlanModel[];
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const cachedPlans = await getCachedJson<PublicPlanItem[]>(CACHE_KEYS.plansPublic());
    if (cachedPlans && Array.isArray(cachedPlans) && cachedPlans.length > 0) {
      return jsonSuccess({ plans: cachedPlans }, { requestId });
    }

    const plans = await db.plan.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        sortOrder: "asc",
      },
      include: {
        modelAccesses: {
          include: {
            catalogModel: {
              select: {
                id: true,
                publicId: true,
                displayName: true,
                shortName: true,
                category: true,
                badge: true,
                status: true,
              },
            },
          },
        },
      },
    });

    // The plan with the smallest monthly cap is the yardstick for the others
    const base = plans
      .map((p) => ({ name: p.name, limit: costLimit(p.monthlyCostLimitUsd) }))
      .filter((p): p is { name: string; limit: number } => p.limit !== null)
      .sort((a, b) => a.limit - b.limit)[0];

    const usageOf = (monthlyCap: number | null): PublicPlanItem["usage"] => {
      if (monthlyCap === null) return { kind: "unlimited" };
      if (!base || monthlyCap <= base.limit) return { kind: "base" };
      const ratio = monthlyCap / base.limit;
      const multiplier = ratio >= 2 ? Math.round(ratio) : Math.round(ratio * 10) / 10;
      return { kind: "multiple", multiplier, baseName: base.name };
    };

    const items: PublicPlanItem[] = plans.map((p) => {
      const discountMonthlyType = isPlanDiscountType(p.discountMonthlyType) ? p.discountMonthlyType : null;
      const discountMonthlyValue = p.discountMonthlyValue != null ? p.discountMonthlyValue : null;
      const discountYearlyType = isPlanDiscountType(p.discountYearlyType) ? p.discountYearlyType : null;
      const discountYearlyValue = p.discountYearlyValue != null ? p.discountYearlyValue : null;
      const monthlyDiscount = { discountType: discountMonthlyType, discountValue: discountMonthlyValue };
      const yearlyDiscount = { discountType: discountYearlyType, discountValue: discountYearlyValue };

      const activeModels: PublicPlanModel[] = p.modelAccesses
        .filter(
          (ma) =>
            ma.catalogModel.status === "active" &&
            ma.catalogModel.category !== IMAGE_CATALOG_CATEGORY
        )
        .map((ma) => ({
          id: ma.catalogModel.id.toString(),
          publicId: ma.catalogModel.publicId,
          displayName: ma.catalogModel.displayName,
          shortName: ma.catalogModel.shortName,
          category: ma.catalogModel.category,
          badge: ma.catalogModel.badge,
        }));

      return {
        id: p.id.toString(),
        slug: p.slug,
        name: p.name,
        description: p.description,
        priceMonthly: p.priceMonthly,
        priceYearly: p.priceYearly,
        currency: p.currency,
        discountMonthlyType,
        discountMonthlyValue,
        discountYearlyType,
        discountYearlyValue,
        effectivePriceMonthly: applyPlanDiscount(p.priceMonthly, monthlyDiscount),
        effectivePriceYearly: applyPlanDiscount(p.priceYearly, yearlyDiscount),
        usage: usageOf(costLimit(p.monthlyCostLimitUsd)),
        dailyRequestLimit: p.dailyRequestLimit,
        requestsPerMinute: p.requestsPerMinute,
        badge: p.badge,
        sortOrder: p.sortOrder,
        features: normalizePlanFeatures(p.features),
        models: activeModels,
      };
    });

    await setCachedJson(CACHE_KEYS.plansPublic(), items, CACHE_TTL.PLANS);

    return jsonSuccess({ plans: items }, { requestId });
  } catch (err) {
    console.error(`[PLANS_LIST_ERROR] [${requestId}]`, err);
    return jsonError(err, { requestId });
  }
}
