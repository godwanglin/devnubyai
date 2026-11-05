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
  requestRetryAttempts: "routing.request_retry_attempts",
  fallbackModelPattern: "routing.fallback_model_pattern",
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
  /** Total tries of one chat request (1 = no retry); shown to the user as "attempt x/N" */
  requestRetryAttempts: z.number().int().min(1).max(10),
  /**
   * Regex (case-insensitive) of catalog model ids tried first when a request moves to
   * another model, e.g. `auto` for `devnuby/auto`. Empty: no preference, catalog order.
   */
  fallbackModelPattern: z.string().max(200),
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

export interface RequestRetrySettings {
  requestRetryAttempts: number;
  fallbackModelPattern: string;
}

/** Saves the chat request retry policy (admin panel) and drops the cached settings. */
export async function updateRequestRetrySettings(
  input: RequestRetrySettings,
  userId?: bigint | null
): Promise<RequestRetrySettings> {
  const parsed = settingsSchema
    .pick({ requestRetryAttempts: true, fallbackModelPattern: true })
    .parse({ ...input, fallbackModelPattern: input.fallbackModelPattern.trim() });
  if (parsed.fallbackModelPattern) {
    try {
      new RegExp(parsed.fallbackModelPattern, "i");
    } catch {
      throw new RoutingConfigError(`'${parsed.fallbackModelPattern}' is not a valid regular expression`);
    }
  }

  await db.$transaction([
    db.appSetting.upsert({
      where: { settingKey: SETTING_KEYS.requestRetryAttempts },
      create: { settingKey: SETTING_KEYS.requestRetryAttempts, value: parsed.requestRetryAttempts, updatedBy: userId ?? null },
      update: { value: parsed.requestRetryAttempts, updatedBy: userId ?? null },
    }),
    db.appSetting.upsert({
      where: { settingKey: SETTING_KEYS.fallbackModelPattern },
      create: { settingKey: SETTING_KEYS.fallbackModelPattern, value: parsed.fallbackModelPattern, updatedBy: userId ?? null },
      update: { value: parsed.fallbackModelPattern, updatedBy: userId ?? null },
    }),
  ]);
  invalidateRoutingSettingsCache();
  return parsed;
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
