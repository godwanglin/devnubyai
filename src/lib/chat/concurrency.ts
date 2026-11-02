import { randomUUID } from "node:crypto";
import { redis } from "@/lib/redis/client";
import { ApiError } from "@/lib/api/response";

/**
 * Per-user cap on concurrent generations, shared across instances via a Redis
 * sorted set (member = assistant message id, score = slot expiry). Slots expire
 * on their own so a crashed stream can't hold one forever.
 */
export const DEFAULT_MAX_PARALLEL_REQUESTS = 3;
const SLOT_TTL_MS = 10 * 60 * 1000;

const slotKey = (userId: bigint) => `gen:active:${userId}`;

// Drop expired slots, then add ours only if there is room. Returns 1 when acquired.
const ACQUIRE_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1
`;

const localSlots = new Map<string, Map<string, number>>();

function localActive(key: string, now: number): Map<string, number> {
  const slots = localSlots.get(key) ?? new Map<string, number>();
  for (const [id, expiresAt] of slots) if (expiresAt <= now) slots.delete(id);
  localSlots.set(key, slots);
  return slots;
}

export function effectiveParallelLimit(maxParallelRequests: number | null | undefined): number {
  return maxParallelRequests && maxParallelRequests > 0 ? maxParallelRequests : DEFAULT_MAX_PARALLEL_REQUESTS;
}

/** Claims a generation slot; false when the user already runs `limit` generations. */
export async function acquireGenerationSlot(userId: bigint, slotId: string, limit: number): Promise<boolean> {
  const key = slotKey(userId);
  const now = Date.now();
  if (redis) {
    try {
      const acquired = await redis.eval(
        ACQUIRE_SCRIPT, 1, key, String(now), String(now + SLOT_TTL_MS), String(limit), slotId, String(SLOT_TTL_MS)
      );
      return Number(acquired) === 1;
    } catch {
      // fall through to the per-process fallback
    }
  }
  const slots = localActive(key, now);
  if (slots.size >= limit) return false;
  slots.set(slotId, now + SLOT_TTL_MS);
  return true;
}

/**
 * Claims a slot or throws 429; returns the release function the caller must
 * run (or hand to the generation stream) once the generation ends.
 */
export async function claimGenerationSlot(userId: bigint, limit: number): Promise<() => Promise<void>> {
  const slotId = randomUUID();
  if (!(await acquireGenerationSlot(userId, slotId, limit))) {
    throw ApiError.rateLimited(
      `Too many responses are being generated at once (max ${limit}). Wait for one to finish and try again.`
    );
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await releaseGenerationSlot(userId, slotId);
  };
}

export async function releaseGenerationSlot(userId: bigint, slotId: string): Promise<void> {
  const key = slotKey(userId);
  localSlots.get(key)?.delete(slotId);
  if (!redis) return;
  try {
    await redis.zrem(key, slotId);
  } catch {
    // the slot expires on its own
  }
}

/** Generations currently running for the user (counted toward request limits). */
export async function countActiveGenerations(userId: bigint): Promise<number> {
  const key = slotKey(userId);
  const now = Date.now();
  if (redis) {
    try {
      return await redis.zcount(key, String(now), "+inf");
    } catch {
      // fall through
    }
  }
  return localActive(key, now).size;
}
