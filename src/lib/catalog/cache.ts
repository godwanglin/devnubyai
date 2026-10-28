import { db } from "@/lib/db";
import { getCachedJson, setCachedJson, invalidateCacheKey } from "@/lib/redis/client";
import type { ApiModelItem } from "@/app/api/v1/models/route";

const CATALOG_CACHE_KEY = "catalog:models:active";
const CATALOG_CACHE_TTL = 3600; // 1 hour in Redis (invalidated on mutation)

// Local memory fallback if Redis is unavailable or cold
let localCatalogFallback: { models: ApiModelItem[]; timestamp: number } | null = null;

/**
 * Fetch active catalog models for users/composer.
 * Uses Redis cache (with fallback to local memory) to avoid repeated DB hits.
 */
export async function getActiveCatalogModels(): Promise<ApiModelItem[]> {
  // 1. Try Redis cache first
  const redisCached = await getCachedJson<ApiModelItem[]>(CATALOG_CACHE_KEY);
  if (redisCached && Array.isArray(redisCached) && redisCached.length > 0) {
    return redisCached;
  }

  // 2. Check local memory fallback
  if (localCatalogFallback && Date.now() - localCatalogFallback.timestamp < 60_000) {
    return localCatalogFallback.models;
  }

  // 3. Query Database
  const models = await db.catalogModel.findMany({
    where: {
      status: "active",
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
 * Invalidate the active catalog models cache in Redis & memory.
 * Called on admin model create/update/delete/toggle events.
 */
export async function invalidateActiveCatalogCache(): Promise<void> {
  localCatalogFallback = null;
  await invalidateCacheKey(CATALOG_CACHE_KEY);
}
