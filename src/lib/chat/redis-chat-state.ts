import { redis, getCachedJson, setCachedJson, invalidateCacheKey } from "@/lib/redis/client";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/client";

/**
 * Redis-first working memory & deferred write-behind queue for active chat turns.
 * Keeps per-turn state and session working memory in Redis during generation,
 * then merges/flushes to Postgres once the turn finishes.
 * If Postgres connection is saturated, data remains safely in Redis pending queue
 * and will be retried automatically without breaking user experience.
 */

export interface ProducedFileInfo {
  filename: string;
  displayName: string;
  mimeType?: string;
  createdAt: string;
}

export interface SessionWorkingMemory {
  sessionId: string;
  filesProduced: ProducedFileInfo[];
  lastTurnSummary?: string;
  updatedAt: string;
}

export interface TurnDraftState {
  assistantMessageId: string;
  assistantMessagePublicId: string;
  sessionId: string;
  userId: string;
  fullContent: string;
  fullReasoning?: string | null;
  parts: Record<string, unknown>[];
  status: "completed" | "failed" | "aborted";
  errorCode?: string | null;
  promptTokens: number;
  completionTokens: number;
  updatedAt: string;
}

const REDIS_TTL = {
  SESSION_MEMORY: 7200, // 2 hours
  TURN_DRAFT: 3600, // 1 hour
} as const;

const PENDING_FLUSH_SET_KEY = "chat:pending_flush_set";

function sessionMemoryKey(sessionId: string | bigint): string {
  return `chat:session:${sessionId.toString()}:memory`;
}

function turnDraftKey(assistantMessagePublicId: string): string {
  return `chat:turn:${assistantMessagePublicId}`;
}

/** Save or update session working memory in Redis (~1ms) */
export async function saveSessionMemoryToRedis(
  sessionId: string | bigint,
  memory: Partial<SessionWorkingMemory>
): Promise<void> {
  const key = sessionMemoryKey(sessionId);
  const existing = (await getCachedJson<SessionWorkingMemory>(key)) ?? {
    sessionId: sessionId.toString(),
    filesProduced: [],
    updatedAt: new Date().toISOString(),
  };

  const updated: SessionWorkingMemory = {
    ...existing,
    ...memory,
    filesProduced: memory.filesProduced ?? existing.filesProduced,
    updatedAt: new Date().toISOString(),
  };

  await setCachedJson(key, updated, REDIS_TTL.SESSION_MEMORY);
}

/** Read session working memory from Redis */
export async function getSessionMemoryFromRedis(
  sessionId: string | bigint
): Promise<SessionWorkingMemory | null> {
  return getCachedJson<SessionWorkingMemory>(sessionMemoryKey(sessionId));
}

/** Save live turn draft state to Redis as tools and text stream in */
export async function saveTurnDraftToRedis(state: TurnDraftState): Promise<void> {
  const key = turnDraftKey(state.assistantMessagePublicId);
  await setCachedJson(key, state, REDIS_TTL.TURN_DRAFT);
}

/** Retrieve turn draft state from Redis */
export async function getTurnDraftFromRedis(
  assistantMessagePublicId: string
): Promise<TurnDraftState | null> {
  return getCachedJson<TurnDraftState>(turnDraftKey(assistantMessagePublicId));
}

/**
 * Flush completed or stopped turn to Postgres.
 * If Postgres write succeeds, clean up turn draft.
 * If Postgres fails (busy, timeout), enqueue to pending_flush_set in Redis.
 */
export async function flushTurnToDatabase(state: TurnDraftState): Promise<{ success: boolean; enqueued: boolean }> {
  try {
    const assistantIdBigInt = BigInt(state.assistantMessageId);

    await db.chatMessage.update({
      where: { id: assistantIdBigInt },
      data: {
        content: state.fullContent,
        reasoning: state.fullReasoning || null,
        parts:
          state.parts.length > 0
            ? (state.parts as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        status: state.status,
        errorCode: state.errorCode || null,
        promptTokens: state.promptTokens || null,
        completionTokens: state.completionTokens || null,
      },
    });

    // Cleanup successful turn draft from Redis
    await invalidateCacheKey(turnDraftKey(state.assistantMessagePublicId));
    if (redis) {
      await redis.srem(PENDING_FLUSH_SET_KEY, state.assistantMessagePublicId).catch(() => {});
    }

    return { success: true, enqueued: false };
  } catch (dbErr) {
    console.warn(`[WRITE_BEHIND_DEFERRED] Postgres flush failed for ${state.assistantMessagePublicId}, queueing in Redis:`, dbErr);

    // Save to Redis and enqueue in pending set
    await saveTurnDraftToRedis(state);
    if (redis) {
      await redis.sadd(PENDING_FLUSH_SET_KEY, state.assistantMessagePublicId).catch(() => {});
    }

    return { success: false, enqueued: true };
  }
}

/**
 * Background worker to drain pending flushes from Redis to Postgres.
 * Called lazily or on periodic turns to ensure eventual consistency.
 */
export async function drainPendingFlushes(limit = 10): Promise<{ processed: number; succeeded: number }> {
  if (!redis) return { processed: 0, succeeded: 0 };

  try {
    const pendingIds = await redis.smembers(PENDING_FLUSH_SET_KEY);
    if (!pendingIds || pendingIds.length === 0) return { processed: 0, succeeded: 0 };

    const batch = pendingIds.slice(0, limit);
    let succeeded = 0;

    for (const publicId of batch) {
      const draft = await getTurnDraftFromRedis(publicId);
      if (!draft) {
        // Expired or invalid, remove from pending
        await redis.srem(PENDING_FLUSH_SET_KEY, publicId).catch(() => {});
        continue;
      }

      const res = await flushTurnToDatabase(draft);
      if (res.success) {
        succeeded += 1;
      }
    }

    return { processed: batch.length, succeeded };
  } catch (err) {
    console.error("[DRAIN_PENDING_FLUSHES_ERROR]", err);
    return { processed: 0, succeeded: 0 };
  }
}
