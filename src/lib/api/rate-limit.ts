import { redis } from "@/lib/redis/client";

/**
 * Fixed-window counter shared by all instances through Redis, with a
 * per-process fallback when Redis is unavailable. Keys must not contain raw
 * user input other than already-validated identifiers.
 */
const localCounters = new Map<string, { count: number; resetAt: number }>();

function bumpLocal(key: string, windowSeconds: number): number {
  const now = Date.now();
  const entry = localCounters.get(key);
  if (!entry || entry.resetAt <= now) {
    localCounters.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

/** Increment the counter for `key` and return the new count within the window. */
export async function incrementRateCounter(key: string, windowSeconds: number): Promise<number> {
  if (redis) {
    try {
      // Atomic: the TTL is set together with the key, so it can never be left without expiry
      const results = await redis.multi().set(key, 0, "EX", windowSeconds, "NX").incr(key).exec();
      const incr = results?.[1];
      if (incr && !incr[0]) return Number(incr[1]);
    } catch {
      // fall through to the local counter
    }
  }
  return bumpLocal(key, windowSeconds);
}

/** Clear the counter for `key` (e.g. after a successful login). */
export async function resetRateCounter(key: string): Promise<void> {
  localCounters.delete(key);
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    // best effort
  }
}
