import { db } from "@/lib/db";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { applyPlanDiscount, isPlanDiscountType, type PlanDiscountType } from "@/lib/plans/pricing";
import { getCachedJson, setCachedJson } from "@/lib/redis/client";
import { CACHE_KEYS, CACHE_TTL } from "@/lib/redis/cache-keys";

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
  monthlyTokenLimit: number | null;
  weeklyTokenLimit: number | null;
  fiveHourTokenLimit: number | null;
  dailyRequestLimit: number | null;
  requestsPerMinute: number | null;
  badge: string | null;
  sortOrder: number;
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

    const items: PublicPlanItem[] = plans.map((p) => {
      const discountMonthlyType = isPlanDiscountType(p.discountMonthlyType) ? p.discountMonthlyType : null;
      const discountMonthlyValue = p.discountMonthlyValue != null ? p.discountMonthlyValue : null;
      const discountYearlyType = isPlanDiscountType(p.discountYearlyType) ? p.discountYearlyType : null;
      const discountYearlyValue = p.discountYearlyValue != null ? p.discountYearlyValue : null;
      const monthlyDiscount = { discountType: discountMonthlyType, discountValue: discountMonthlyValue };
      const yearlyDiscount = { discountType: discountYearlyType, discountValue: discountYearlyValue };

      const activeModels: PublicPlanModel[] = p.modelAccesses
        .filter((ma) => ma.catalogModel.status === "active")
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
        monthlyTokenLimit: p.monthlyTokenLimit != null ? Number(p.monthlyTokenLimit) : null,
        weeklyTokenLimit: p.weeklyTokenLimit != null ? Number(p.weeklyTokenLimit) : null,
        fiveHourTokenLimit: p.fiveHourTokenLimit != null ? Number(p.fiveHourTokenLimit) : null,
        dailyRequestLimit: p.dailyRequestLimit,
        requestsPerMinute: p.requestsPerMinute,
        badge: p.badge,
        sortOrder: p.sortOrder,
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
