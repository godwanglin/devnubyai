import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis?: Redis;
};

/**
 * Returns a shared singleton ioredis client.
 * Falls back gracefully if REDIS_URL is not configured or fails to connect.
 */
function createRedisClient(): Redis | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[REDIS] REDIS_URL is not set. Cache operations will fall back to in-memory.");
    }
    return null;
  }

  try {
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      connectTimeout: 10000,
      keepAlive: 10000,
      retryStrategy(times) {
        // Exponential backoff capped at 2 seconds
        return Math.min(times * 100, 2000);
      },
      reconnectOnError(err) {
        const targetError = "READONLY";
        if (err.message.includes(targetError)) {
          return true;
        }
        return false;
      },
      lazyConnect: false,
    });

    client.on("error", (err) => {
      console.error("[REDIS_ERROR]", err.message);
    });

    return client;
  } catch (err) {
    console.error("[REDIS_INIT_FAILED]", err);
    return null;
  }
}

export const redis: Redis | null =
  globalForRedis.redis !== undefined ? globalForRedis.redis : createRedisClient();

if (process.env.NODE_ENV !== "production" && redis) {
  globalForRedis.redis = redis;
}

/**
 * Helper to get JSON cached data with automatic error recovery
 */
export async function getCachedJson<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[REDIS_GET_ERROR] key: ${key}`, err);
    return null;
  }
}

/**
 * Helper to set JSON cached data with TTL (in seconds)
 */
export async function setCachedJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  if (!redis) return;
  try {
    const serialized = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await redis.set(key, serialized, "EX", ttlSeconds);
    } else {
      await redis.set(key, serialized);
    }
  } catch (err) {
    console.warn(`[REDIS_SET_ERROR] key: ${key}`, err);
  }
}

/**
 * Helper to delete keys matching exact name or pattern
 */
export async function invalidateCacheKey(key: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(key);
  } catch (err) {
    console.warn(`[REDIS_DEL_ERROR] key: ${key}`, err);
  }
}

/**
 * Deletes keys matching a pattern with incremental SCAN, so it never blocks
 * Redis the way KEYS does on a large keyspace. Best effort.
 */
export async function deleteKeysByScan(pattern: string): Promise<void> {
  if (!redis) return;
  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== "0");
  } catch (err) {
    console.warn(`[REDIS_SCAN_DEL_ERROR] pattern: ${pattern}`, err);
  }
}

/**
 * Invalidate all keys matching a prefix/pattern e.g. "routing:*"
 */
export async function invalidateCachePattern(pattern: string): Promise<void> {
  if (!redis) return;
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (err) {
    console.warn(`[REDIS_PATTERN_DEL_ERROR] pattern: ${pattern}`, err);
  }
}
