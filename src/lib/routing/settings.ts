import { z } from "zod";
import { db } from "@/lib/db";
import { getCachedJson, setCachedJson, invalidateCacheKey, invalidateCachePattern } from "@/lib/redis/client";

/**
 * Routing configuration lives only in `app_settings` (admin-managed).
 * There are intentionally no in-code defaults: a missing or invalid key is a
 * configuration error that must be fixed from the admin panel / seed.
 */
const ROUTING_ERROR_CLASSES = [
  "timeout",
  "network",
  "http_5xx",
  "rate_limited",
  "model_not_found",
  "auth",
  "bad_request",
  "unknown",
] as const;

const SETTING_KEYS = {
  primaryFirst: "routing.primary_first",
  maxAttempts: "routing.max_attempts",
  retryOnStatus: "routing.retry_on_status",
  fallbackOnModelNotFound: "routing.fallback_on_model_not_found",
  fallbackOnErrors: "routing.fallback_on_errors",
  circuitFailureThreshold: "routing.circuit_failure_threshold",
  circuitCooldownSeconds: "routing.circuit_cooldown_seconds",
  cacheTtlSeconds: "routing.cache_ttl_seconds",
  version: "routing.version",
  defaultModel: "catalog.default_model",
} as const;

const settingsSchema = z.object({
  primaryFirst: z.boolean(),
  maxAttempts: z.number().int().min(1),
  retryOnStatus: z.array(z.number().int().min(100).max(599)),
  fallbackOnModelNotFound: z.boolean(),
  fallbackOnErrors: z.array(z.enum(ROUTING_ERROR_CLASSES)),
  circuitFailureThreshold: z.number().int().min(1),
  circuitCooldownSeconds: z.number().int().min(0),
  cacheTtlSeconds: z.number().int().min(0),
  version: z.number().int().min(0),
  defaultModel: z.string().min(1),
});

export type RoutingSettings = z.infer<typeof settingsSchema>;

export class RoutingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutingConfigError";
  }
}

interface CacheEntry {
  settings: RoutingSettings;
  expiresAt: number;
}

let cached: CacheEntry | null = null;

function parseSettings(
  rows: Array<{ settingKey: string; value: unknown }>
): RoutingSettings {
  const byKey = new Map(rows.map((row) => [row.settingKey, row.value]));
  const raw: Record<string, unknown> = {};
  for (const [field, key] of Object.entries(SETTING_KEYS)) {
    raw[field] = byKey.get(key);
  }

  const result = settingsSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => {
        const field = issue.path[0] as keyof typeof SETTING_KEYS;
        return `${SETTING_KEYS[field] ?? String(field)}: ${issue.message}`;
      })
      .join("; ");
    throw new RoutingConfigError(
      `Invalid or missing routing settings in app_settings (${problems})`
    );
  }
  return result.data;
}

const REDIS_ROUTING_SETTINGS_KEY = "routing:settings";

/**
 * Fetch routing settings from app_settings with Redis + local cache
 * whose TTL is itself `routing.cache_ttl_seconds`.
 */
export async function getRoutingSettings(options?: {
  forceRefresh?: boolean;
}): Promise<RoutingSettings> {
  const now = Date.now();
  if (!options?.forceRefresh) {
    if (cached && now < cached.expiresAt) {
      return cached.settings;
    }
    const redisCached = await getCachedJson<RoutingSettings>(REDIS_ROUTING_SETTINGS_KEY);
    if (redisCached) {
      cached = { settings: redisCached, expiresAt: now + redisCached.cacheTtlSeconds * 1000 };
      return redisCached;
    }
  }

  const rows = await db.appSetting.findMany({
    where: { settingKey: { in: Object.values(SETTING_KEYS) } },
    select: { settingKey: true, value: true },
  });

  const settings = parseSettings(rows);
  cached = { settings, expiresAt: now + settings.cacheTtlSeconds * 1000 };
  await setCachedJson(REDIS_ROUTING_SETTINGS_KEY, settings, settings.cacheTtlSeconds);
  return settings;
}

/**
 * Invalidate the cache in Redis & memory. Call this after admin mutations.
 */
export function invalidateRoutingSettingsCache(): void {
  cached = null;
  void invalidateCacheKey(REDIS_ROUTING_SETTINGS_KEY);
  void invalidateCachePattern("routing:candidates:*");
}

/**
 * Bumps `routing.version` in DB and clears the memory cache so every cached
 * candidate resolution becomes stale immediately.
 */
export async function bumpRoutingVersion(
  userId?: bigint | null,
  client: { appSetting: typeof db.appSetting } = db
): Promise<number> {
  const current = await getRoutingSettings({ forceRefresh: true });
  const nextVersion = current.version + 1;

  await client.appSetting.update({
    where: { settingKey: SETTING_KEYS.version },
    data: { value: nextVersion, updatedBy: userId ?? null },
  });

  invalidateRoutingSettingsCache();
  return nextVersion;
}
