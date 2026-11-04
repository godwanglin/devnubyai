import { db } from "@/lib/db";
import { getCachedJson, invalidateCacheKey, setCachedJson } from "@/lib/redis/client";

/**
 * Per-user memory preferences (Settings → Memory). Read on every chat turn, so
 * they are cached in Redis and dropped on update; a user without a row gets the
 * defaults (memory on, matching how `memory_note` always behaved).
 */
export interface MemorySettings {
  memoryEnabled: boolean;
  chatSearchEnabled: boolean;
  includeSensitive: boolean;
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  memoryEnabled: true,
  chatSearchEnabled: false,
  includeSensitive: false,
};

const SETTINGS_CACHE_TTL = 86_400;
const settingsKey = (userId: bigint) => `memory:settings:${userId}`;

export async function getMemorySettings(userId: bigint): Promise<MemorySettings> {
  const cached = await getCachedJson<MemorySettings>(settingsKey(userId));
  if (cached) return cached;

  const row = await db.userMemorySettings.findUnique({
    where: { userId },
    select: { memoryEnabled: true, chatSearchEnabled: true, includeSensitive: true },
  });
  const settings = row ?? DEFAULT_MEMORY_SETTINGS;
  await setCachedJson(settingsKey(userId), settings, SETTINGS_CACHE_TTL);
  return settings;
}

export async function updateMemorySettings(
  userId: bigint,
  patch: Partial<MemorySettings>
): Promise<MemorySettings> {
  const row = await db.userMemorySettings.upsert({
    where: { userId },
    create: { userId, ...DEFAULT_MEMORY_SETTINGS, ...patch },
    update: patch,
    select: { memoryEnabled: true, chatSearchEnabled: true, includeSensitive: true },
  });
  await invalidateCacheKey(settingsKey(userId));
  return row;
}
