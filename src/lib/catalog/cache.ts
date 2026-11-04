import { db } from "@/lib/db";
import {
  getCachedJson,
  setCachedJson,
  invalidateCacheKey,
  invalidateCachePattern,
} from "@/lib/redis/client";
import { invalidatePlansCache } from "@/lib/redis/cache-keys";
import { FREE_PLAN_SLUG } from "@/lib/plans/effective-plan";
import { invalidateResolvedModelCache } from "@/lib/chat/generate";
import { clearModelAccessCache } from "@/lib/chat/model-access";
import { IMAGE_CATALOG_CATEGORY } from "@/lib/images/settings";
import type { ApiModelItem } from "@/app/api/v1/models/route";

const CATALOG_CACHE_KEY = "catalog:models:active";
const CATALOG_CACHE_TTL = 3600; // 1 hour in Redis (invalidated on mutation)

// Local memory fallback if Redis is unavailable or cold
let localCatalogFallback: { models: ApiModelItem[]; timestamp: number } | null = null;
const localPlanCatalogFallback = new Map<string, { models: ApiModelItem[]; timestamp: number }>();

/**
 * Fetch active catalog models for users/composer.
 * Uses Redis cache (with fallback to local memory) to avoid repeated DB hits.
 */
export async function getActiveCatalogModels(): Promise<ApiModelItem[]> {
  const now = Date.now();

  // 1. Check local fast memory cache first (0.01ms)
  if (localCatalogFallback && now - localCatalogFallback.timestamp < 30_000) {
    return localCatalogFallback.models;
  }

  // 2. Try Redis cache (remote L2)
  const redisCached = await getCachedJson<ApiModelItem[]>(CATALOG_CACHE_KEY);
  if (redisCached && Array.isArray(redisCached) && redisCached.length > 0) {
    localCatalogFallback = { models: redisCached, timestamp: now };
    return redisCached;
  }

  // 3. Query Database
  const models = await db.catalogModel.findMany({
    where: {
      status: "active",
      // Image models only serve the generate_image tool; never list them in the chat picker
      category: { not: IMAGE_CATALOG_CATEGORY },
    },
    orderBy: {
      sortOrder: "asc",
    },
    include: {
      provider: {
        select: {
          slug: true,
          name: true,
          logoKey: true,
          logoUrl: true,
        },
      },
    },
  });

  const items: ApiModelItem[] = models.map((m) => {
    const category: "Powerful" | "Fast" =
      m.category.toLowerCase() === "fast" ? "Fast" : "Powerful";

    const meta = m.contextWindow
      ? `${Math.round(m.contextWindow / 1000)}k`
      : m.badge ?? category;

    return {
      id: m.publicId,
      shortName: m.shortName,
      fullName: m.displayName,
      meta,
      description: m.description ?? "",
      category,
      badge: m.badge,
      provider: {
        slug: m.provider.slug,
        name: m.provider.name,
        logoKey: m.provider.logoKey,
        logoUrl: m.provider.logoUrl,
      },
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
      capabilities: {
        vision: m.supportsVision,
        tools: m.supportsTools,
        reasoning: m.supportsReasoning,
      },
    };
  });

  // Save to Redis and local memory
  localCatalogFallback = {
    models: items,
    timestamp: Date.now(),
  };
  await setCachedJson(CATALOG_CACHE_KEY, items, CATALOG_CACHE_TTL);

  return items;
}

/**
 * Fetch active catalog models with lock state based on a subscription plan.
 */
export async function getActiveCatalogModelsForPlan(
  planId: bigint | null
): Promise<ApiModelItem[]> {
  const now = Date.now();
  const allModels = await getActiveCatalogModels();

  // If user has no plan, look up 'free' plan
  let effectivePlanId = planId;
  if (!effectivePlanId) {
    const freePlan = await db.plan.findUnique({
      where: { slug: FREE_PLAN_SLUG },
      select: { id: true },
    });
    effectivePlanId = freePlan?.id ?? null;
  }

  if (!effectivePlanId) {
    return allModels.map((m) => ({ ...m, isLocked: false }));
  }

  const planKey = `catalog:models:plan:v2:${effectivePlanId.toString()}`;

  // 1. Check local fast memory cache first (0.01ms)
  const memCached = localPlanCatalogFallback.get(planKey);
  if (memCached && now - memCached.timestamp < 30_000) {
    return memCached.models;
  }

  // 2. Try Redis cache (remote L2)
  const redisCached = await getCachedJson<ApiModelItem[]>(planKey);
  if (redisCached && Array.isArray(redisCached) && redisCached.length > 0) {
    localPlanCatalogFallback.set(planKey, { models: redisCached, timestamp: now });
    return redisCached;
  }

  // Active plans in display order, with the models each one grants
  const plans = await db.plan.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      sortOrder: true,
      modelAccesses: { select: { catalogModel: { select: { publicId: true } } } },
    },
  });
  const currentPlan = plans.find((p) => p.id === effectivePlanId);
  const allowedPublicIds = new Set(
    currentPlan?.modelAccesses.map((a) => a.catalogModel.publicId) ??
      (
        await db.planModelAccess.findMany({
          where: { planId: effectivePlanId },
          select: { catalogModel: { select: { publicId: true } } },
        })
      ).map((a) => a.catalogModel.publicId)
  );
  // Only plans above the user's current one are upgrade targets
  const upgradePlans = plans
    .filter((p) => !currentPlan || p.sortOrder > currentPlan.sortOrder)
    .map((p) => ({ name: p.name, ids: new Set(p.modelAccesses.map((a) => a.catalogModel.publicId)) }));

  const modelsWithLockState = allModels.map((m) => {
    const isLocked = !allowedPublicIds.has(m.id);
    return {
      ...m,
      isLocked,
      ...(isLocked
        ? { requiredPlans: upgradePlans.filter((p) => p.ids.has(m.id)).map((p) => p.name) }
        : {}),
    };
  });

  localPlanCatalogFallback.set(planKey, {
    models: modelsWithLockState,
    timestamp: Date.now(),
  });
  await setCachedJson(planKey, modelsWithLockState, CATALOG_CACHE_TTL);

  return modelsWithLockState;
}

/**
 * Invalidate the active catalog models cache in Redis & memory.
 * Called on admin model create/update/delete/toggle events.
 */
export async function invalidateActiveCatalogCache(): Promise<void> {
  localCatalogFallback = null;
  localPlanCatalogFallback.clear();
  try {
    invalidateResolvedModelCache();
    clearModelAccessCache();
  } catch {}
  await Promise.allSettled([
    invalidateCacheKey(CATALOG_CACHE_KEY),
    invalidateCachePattern("catalog:models:*"),
    invalidatePlansCache(),
  ]);
}
