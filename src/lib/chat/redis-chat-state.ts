import { redis, getCachedJson, setCachedJson } from "@/lib/redis/client";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/client";
import { invalidateSharedChatCache, invalidateUserQuotaCache } from "@/lib/redis/cache-keys";
import { computeCostUsd } from "@/lib/billing/cost";
import {
  FIVE_HOURS_MS,
  WEEK_MS,
  getCurrentPeriodStart,
  getFiveHourStart,
  getUtcWeekStart,
} from "./quota-windows";
import { appendCachedHistory, invalidateHistoryCache } from "./history-cache";
import { invalidateChatSessionCache } from "./session-cache";
import { pendingHistoryEntries } from "./pending-turns";

/**
 * Redis-first chat turns.
 *
 * A turn (user message + assistant reply) lives only in Redis while it streams:
 * nothing is written to Postgres before the first token. When the turn ends
 * (completed, failed or stopped) it is stored with ONE Postgres transaction
 * (messages, session update, usage). If Postgres is busy or down, the turn stays
 * in Redis on a pending set and a background worker retries it; meanwhile every
 * reader (message list, history, stop, tool-state) also looks at Redis.
 *
 * Without Redis (local dev with no REDIS_URL) the same store runs in process memory.
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

export interface TurnAttachment {
  publicId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface PendingUserMessage {
  publicId: string;
  content: string;
  /** Quote / source-mention parts, stored as `chat_messages.parts` */
  parts: Record<string, unknown>[] | null;
  fileIds: string[];
  attachments: TurnAttachment[];
  /** Same text the gateway history uses for this message */
  historyContent: string;
}

export type TurnStatus = "streaming" | "completed" | "failed" | "aborted";

export interface PendingAssistantMessage {
  publicId: string;
  content: string;
  reasoning: string | null;
  parts: Record<string, unknown>[];
  status: TurnStatus;
  errorCode: string | null;
  catalogModelId: string;
  catalogModelPublicId: string;
  promptTokens: number;
  completionTokens: number;
}

export interface TurnUsage {
  promptTokens: number;
  completionTokens: number;
  inputPricePerMillion: string;
  outputPricePerMillion: string;
}

export interface PendingTurn {
  /** "send": new user + assistant rows. "regenerate": rewrites an existing assistant row. */
  kind: "send" | "regenerate";
  requestId: string;
  userId: string;
  sessionId: string;
  sessionPublicId: string;
  /** Set on a chat's first message; applied only while the title is still "New chat" */
  autoTitle: string | null;
  user: PendingUserMessage | null;
  assistant: PendingAssistantMessage;
  /** Billed figures once the turn has ended; null = not billed */
  usage: TurnUsage | null;
  startedAt: number;
  updatedAt: number;
  /** Store attempts so far; a retry checks usage_logs before billing again */
  flushAttempts: number;
}

const TURN_TTL_SECONDS = 7 * 86_400;
const SESSION_MEMORY_TTL = 7200;
const STALE_STREAMING_MS = 30 * 60_000;

// v2: the previous write-behind format used `chat:turn:*` / `chat:pending_flush_set`
// with a different shape; separate keys keep leftovers from it out of these readers.
const PENDING_FLUSH_SET_KEY = "chat:v2:pending_flush";
const ACTIVE_TURNS_KEY = "chat:v2:active_turns";
const turnKey = (publicId: string) => `chat:v2:turn:${publicId}`;
const sessionTurnsKey = (sessionId: string | bigint) => `chat:v2:session:${sessionId}:turns`;
const flushLockKey = (publicId: string) => `chat:v2:flushlock:${publicId}`;
const sessionMemoryKey = (sessionId: string | bigint) => `chat:session:${sessionId.toString()}:memory`;

// ── In-process fallback when Redis is not configured ────────────────────────
const memTurns = new Map<string, PendingTurn>();
const memSessionTurns = new Map<string, Set<string>>();
const memPending = new Set<string>();
const memLocks = new Set<string>();

// ── Session working memory (unchanged behaviour) ────────────────────────────

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

  await setCachedJson(key, updated, SESSION_MEMORY_TTL);
}

export async function getSessionMemoryFromRedis(
  sessionId: string | bigint
): Promise<SessionWorkingMemory | null> {
  return getCachedJson<SessionWorkingMemory>(sessionMemoryKey(sessionId));
}

// ── Turn store ───────────────────────────────────────────────────────────────

async function writeTurn(turn: PendingTurn): Promise<void> {
  turn.updatedAt = Date.now();
  if (!redis) {
    memTurns.set(turn.assistant.publicId, turn);
    return;
  }
  await redis.set(turnKey(turn.assistant.publicId), JSON.stringify(turn), "EX", TURN_TTL_SECONDS);
}

export async function getTurn(assistantPublicId: string): Promise<PendingTurn | null> {
  if (!redis) return memTurns.get(assistantPublicId) ?? null;
  try {
    const raw = await redis.get(turnKey(assistantPublicId));
    return raw ? (JSON.parse(raw) as PendingTurn) : null;
  } catch {
    return null;
  }
}

/** Turns of a chat still held in Redis (streaming or not yet stored), oldest first. */
export async function listSessionTurns(sessionId: bigint | string): Promise<PendingTurn[]> {
  const sid = sessionId.toString();
  if (!redis) {
    const ids = [...(memSessionTurns.get(sid) ?? [])];
    return ids
      .map((id) => memTurns.get(id))
      .filter((t): t is PendingTurn => Boolean(t))
      .sort((a, b) => a.startedAt - b.startedAt);
  }
  try {
    const ids = await redis.zrange(sessionTurnsKey(sid), "0", "-1");
    if (ids.length === 0) return [];
    const raws = await redis.mget(ids.map(turnKey));
    const turns: PendingTurn[] = [];
    const missing: string[] = [];
    raws.forEach((raw, idx) => {
      if (raw) turns.push(JSON.parse(raw) as PendingTurn);
      else missing.push(ids[idx]);
    });
    if (missing.length > 0) await redis.zrem(sessionTurnsKey(sid), ...missing).catch(() => {});
    return turns.sort((a, b) => a.startedAt - b.startedAt);
  } catch {
    return [];
  }
}

/** Registers a new streaming turn. Redis only: ~1 round-trip, no Postgres. */
export async function beginTurn(turn: PendingTurn): Promise<void> {
  if (!redis) {
    memTurns.set(turn.assistant.publicId, turn);
    const set = memSessionTurns.get(turn.sessionId) ?? new Set<string>();
    set.add(turn.assistant.publicId);
    memSessionTurns.set(turn.sessionId, set);
    return;
  }
  turn.updatedAt = Date.now();
  await redis
    .multi()
    .set(turnKey(turn.assistant.publicId), JSON.stringify(turn), "EX", TURN_TTL_SECONDS)
    .zadd(sessionTurnsKey(turn.sessionId), turn.startedAt, turn.assistant.publicId)
    .expire(sessionTurnsKey(turn.sessionId), TURN_TTL_SECONDS)
    .zadd(ACTIVE_TURNS_KEY, turn.updatedAt, turn.assistant.publicId)
    .exec();
}

/**
 * A regeneration started on the same reply replaces the turn under the same key;
 * the older generation (aborted by it) must not overwrite the newer one.
 */
async function isSuperseded(turn: PendingTurn): Promise<boolean> {
  const current = await getTurn(turn.assistant.publicId);
  return current !== null && current.startedAt !== turn.startedAt;
}

/** Saves streaming progress (after each tool round); also a liveness heartbeat. */
export async function saveTurnProgress(turn: PendingTurn): Promise<void> {
  try {
    if (await isSuperseded(turn)) return;
    await writeTurn(turn);
    if (redis) await redis.zadd(ACTIVE_TURNS_KEY, String(turn.updatedAt), turn.assistant.publicId);
  } catch (err) {
    console.warn(`[TURN_PROGRESS_SAVE_FAILED] ${turn.assistant.publicId}`, err);
  }
}

async function removeTurn(turn: PendingTurn): Promise<void> {
  const id = turn.assistant.publicId;
  if (!redis) {
    memTurns.delete(id);
    memSessionTurns.get(turn.sessionId)?.delete(id);
    memPending.delete(id);
    return;
  }
  await redis
    .multi()
    .del(turnKey(id))
    .zrem(sessionTurnsKey(turn.sessionId), id)
    .srem(PENDING_FLUSH_SET_KEY, id)
    .zrem(ACTIVE_TURNS_KEY, id)
    .exec();
}

/**
 * Ends a turn and stores it in Postgres. On failure the turn stays queued in
 * Redis (readers keep serving it) and the flush worker retries it.
 */
export async function completeTurn(turn: PendingTurn): Promise<{ stored: boolean }> {
  if (await isSuperseded(turn)) return { stored: false };
  try {
    await writeTurn(turn);
    if (redis) {
      await redis
        .multi()
        .sadd(PENDING_FLUSH_SET_KEY, turn.assistant.publicId)
        .zrem(ACTIVE_TURNS_KEY, turn.assistant.publicId)
        .exec();
    } else {
      memPending.add(turn.assistant.publicId);
    }
  } catch (err) {
    console.error(`[TURN_QUEUE_FAILED] ${turn.assistant.publicId}`, err);
  }

  // History cache follows the turn right away, so the next message has it even
  // while Postgres is still catching up.
  if (turn.kind === "send") {
    await appendCachedHistory(BigInt(turn.sessionId), pendingHistoryEntries([turn])).catch(() => {});
  } else {
    await invalidateHistoryCache(BigInt(turn.sessionId)).catch(() => {});
  }

  const result = await flushTurn(turn.assistant.publicId, turn);
  return { stored: result === "stored" };
}

async function acquireFlushLock(publicId: string): Promise<boolean> {
  if (!redis) {
    if (memLocks.has(publicId)) return false;
    memLocks.add(publicId);
    return true;
  }
  return (await redis.set(flushLockKey(publicId), "1", "PX", 30_000, "NX")) === "OK";
}

async function releaseFlushLock(publicId: string): Promise<void> {
  if (!redis) {
    memLocks.delete(publicId);
    return;
  }
  await redis.del(flushLockKey(publicId)).catch(() => {});
}

function isPermanentDbError(err: unknown): boolean {
  // P2003: FK violation (chat deleted meanwhile); P2025: row to update is gone
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === "P2003" || err.code === "P2025")
  );
}

/**
 * Stores one ended turn in Postgres with a single transaction:
 * user message, assistant message, file links, session metadata and usage.
 */
async function persistTurn(turn: PendingTurn, checkAlreadyBilled: boolean): Promise<bigint> {
  const sessionId = BigInt(turn.sessionId);
  const userId = BigInt(turn.userId);
  const startedAt = new Date(turn.startedAt);
  const a = turn.assistant;
  const assistantData = {
    content: a.content,
    reasoning: a.reasoning || null,
    parts: a.parts.length > 0 ? (a.parts as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    status: a.status,
    errorCode: a.errorCode,
    promptTokens: a.promptTokens || null,
    completionTokens: a.completionTokens || null,
    catalogModelId: BigInt(a.catalogModelId),
  };

  return db.$transaction(async (tx) => {
    let assistantId: bigint;

    if (turn.kind === "send") {
      if (turn.user) {
        const u = turn.user;
        const userRow = await tx.chatMessage.upsert({
          where: { publicId: u.publicId },
          create: {
            publicId: u.publicId,
            sessionId,
            role: "user",
            content: u.content,
            status: "completed",
            createdAt: startedAt,
            ...(u.parts && u.parts.length > 0 ? { parts: u.parts as unknown as Prisma.InputJsonValue } : {}),
          },
          update: {},
          select: { id: true },
        });
        if (u.fileIds.length > 0) {
          await tx.sessionFile.updateMany({
            where: { publicId: { in: u.fileIds }, sessionId, userId },
            data: { messageId: userRow.id },
          });
        }
      }

      const assistantRow = await tx.chatMessage.upsert({
        where: { publicId: a.publicId },
        create: { ...assistantData, publicId: a.publicId, sessionId, role: "assistant", createdAt: startedAt },
        update: assistantData,
        select: { id: true },
      });
      assistantId = assistantRow.id;

      await tx.chatSession.update({ where: { id: sessionId }, data: { lastMessageAt: startedAt } });
      if (turn.autoTitle) {
        await tx.chatSession.updateMany({
          where: { id: sessionId, title: "New chat" },
          data: { title: turn.autoTitle },
        });
      }
    } else {
      const assistantRow = await tx.chatMessage.update({
        where: { publicId: a.publicId },
        data: assistantData,
        select: { id: true },
      });
      assistantId = assistantRow.id;
    }

    if (turn.usage) {
      const alreadyBilled =
        checkAlreadyBilled &&
        (await tx.usageLog.findFirst({
          where: { userId, messageId: assistantId, createdAt: { gte: startedAt } },
          select: { id: true },
        }));
      if (!alreadyBilled) {
        await writeUsageRows(tx, userId, sessionId, assistantId, turn, startedAt);
      }
    }

    return assistantId;
  });
}

/** usage_logs row + the three spend windows, all inside the turn transaction. */
async function writeUsageRows(
  tx: Prisma.TransactionClient,
  userId: bigint,
  sessionId: bigint,
  messageId: bigint,
  turn: PendingTurn,
  billedAt: Date
): Promise<void> {
  const usage = turn.usage!;
  const promptTokens = Math.max(0, Math.floor(usage.promptTokens));
  const completionTokens = Math.max(0, Math.floor(usage.completionTokens));
  const prompt = BigInt(promptTokens);
  const completion = BigInt(completionTokens);
  const inputPrice = new Prisma.Decimal(usage.inputPricePerMillion);
  const outputPrice = new Prisma.Decimal(usage.outputPricePerMillion);
  const cost = computeCostUsd(promptTokens, completionTokens, inputPrice, outputPrice);

  // Windows of the turn start, same as the live ledger charged them
  const periodStart = getCurrentPeriodStart(billedAt);
  const weekStart = getUtcWeekStart(billedAt);
  const fiveHourStart = getFiveHourStart(billedAt);
  const increment = {
    requestCount: { increment: 1 },
    promptTokens: { increment: prompt },
    completionTokens: { increment: completion },
    costUsd: { increment: cost },
  };
  const initial = { requestCount: 1, promptTokens: prompt, completionTokens: completion, costUsd: cost };

  await tx.usageLog.create({
    data: {
      userId,
      sessionId,
      messageId,
      catalogModelId: BigInt(turn.assistant.catalogModelId),
      requestId: turn.requestId,
      promptTokens,
      completionTokens,
      inputPricePerMillion: inputPrice,
      outputPricePerMillion: outputPrice,
      costUsd: cost,
    },
  });
  await tx.userUsagePeriod.upsert({
    where: { userId_periodStart: { userId, periodStart } },
    update: increment,
    create: { userId, periodStart, ...initial },
  });
  await tx.userUsageWindow.upsert({
    where: { userId_windowType_windowKey: { userId, windowType: "weekly", windowKey: weekStart.toISOString() } },
    update: increment,
    create: {
      userId, windowType: "weekly", windowKey: weekStart.toISOString(),
      windowStart: weekStart, windowEnd: new Date(weekStart.getTime() + WEEK_MS), ...initial,
    },
  });
  await tx.userUsageWindow.upsert({
    where: { userId_windowType_windowKey: { userId, windowType: "five_hour", windowKey: fiveHourStart.toISOString() } },
    update: increment,
    create: {
      userId, windowType: "five_hour", windowKey: fiveHourStart.toISOString(),
      windowStart: fiveHourStart, windowEnd: new Date(fiveHourStart.getTime() + FIVE_HOURS_MS), ...initial,
    },
  });
}

type FlushResult = "stored" | "pending" | "busy" | "gone" | "dropped";

/**
 * Stores a queued turn in Postgres. Safe to call concurrently (per-turn lock)
 * and repeatedly (messages are upserted; usage is not billed twice).
 */
/** Drops the public share snapshot of a chat, if it has a share link. */
async function invalidateSharedChatOf(sessionId: bigint): Promise<void> {
  const session = await db.chatSession.findUnique({
    where: { id: sessionId },
    select: { shareToken: true },
  });
  if (session?.shareToken) await invalidateSharedChatCache(session.shareToken);
}

export async function flushTurn(publicId: string, known?: PendingTurn): Promise<FlushResult> {
  if (!(await acquireFlushLock(publicId))) return "busy";
  try {
    const turn = (await getTurn(publicId)) ?? known ?? null;
    if (!turn) {
      if (redis) await redis.srem(PENDING_FLUSH_SET_KEY, publicId).catch(() => {});
      return "gone";
    }
    if (turn.assistant.status === "streaming") return "pending";

    const isRetry = turn.flushAttempts > 0;
    turn.flushAttempts += 1;
    await writeTurn(turn).catch(() => {});

    try {
      await persistTurn(turn, isRetry);
    } catch (err) {
      if (isPermanentDbError(err)) {
        console.warn(`[TURN_FLUSH_DROPPED] ${publicId}: chat or message no longer exists`);
        await removeTurn(turn);
        return "dropped";
      }
      console.warn(`[WRITE_BEHIND_DEFERRED] Postgres flush failed for ${publicId}, kept in Redis:`, err);
      return "pending";
    }

    await removeTurn(turn);
    const userId = BigInt(turn.userId);
    await Promise.allSettled([
      invalidateChatSessionCache(userId, turn.sessionPublicId),
      // A share link opened before this turn landed must not keep serving the old snapshot
      invalidateSharedChatOf(BigInt(turn.sessionId)),
      // Only the DB-backed display cache; the live ledger already has this spend
      turn.usage ? invalidateUserQuotaCache(userId, { keepLive: true }) : Promise.resolve(),
    ]);
    return "stored";
  } finally {
    await releaseFlushLock(publicId);
  }
}

/** Stores every ended turn of a chat (before edits / regenerations that need Postgres). */
export async function ensureSessionFlushed(sessionId: bigint | string): Promise<boolean> {
  const turns = await listSessionTurns(sessionId);
  let allStored = true;
  for (const turn of turns) {
    if (turn.assistant.status === "streaming") continue;
    const result = await flushTurn(turn.assistant.publicId, turn);
    if (result === "pending" || result === "busy") allStored = false;
  }
  return allStored;
}

/** Background drain of turns whose Postgres write failed. */
export async function drainPendingFlushes(limit = 10): Promise<{ processed: number; succeeded: number }> {
  const ids = redis
    ? await redis.smembers(PENDING_FLUSH_SET_KEY).catch(() => [] as string[])
    : [...memPending];
  const batch = ids.slice(0, limit);
  let succeeded = 0;
  for (const id of batch) {
    const result = await flushTurn(id).catch(() => "pending" as const);
    if (result === "stored") succeeded += 1;
    if (!redis && (result === "stored" || result === "gone" || result === "dropped")) memPending.delete(id);
  }
  return { processed: batch.length, succeeded };
}

/**
 * Turns still marked streaming with no heartbeat for a long time belong to a
 * process that died (deploy, crash). They are closed as aborted and stored.
 */
export async function recoverStaleTurns(isLocallyActive: (publicId: string) => boolean): Promise<number> {
  if (!redis) return 0;
  const cutoff = Date.now() - STALE_STREAMING_MS;
  const ids = await redis.zrangebyscore(ACTIVE_TURNS_KEY, "-inf", cutoff).catch(() => [] as string[]);
  let recovered = 0;
  for (const id of ids) {
    if (isLocallyActive(id)) continue;
    const turn = await getTurn(id);
    if (!turn) {
      await redis.zrem(ACTIVE_TURNS_KEY, id).catch(() => {});
      continue;
    }
    if (turn.assistant.status === "streaming") {
      turn.assistant.status = "aborted";
      turn.assistant.errorCode = "SERVER_INTERRUPTED";
    }
    await completeTurn(turn);
    recovered += 1;
  }
  return recovered;
}

/** Applies a tool-state patch to a turn still held in Redis. Returns false when absent. */
export async function patchTurnParts(
  assistantPublicId: string,
  sessionId: bigint,
  patch: (parts: Record<string, unknown>[]) => Record<string, unknown>[] | null
): Promise<boolean | null> {
  const turn = await getTurn(assistantPublicId);
  if (!turn || turn.sessionId !== sessionId.toString()) return null;
  const next = patch(turn.assistant.parts);
  if (!next) return false;
  turn.assistant.parts = next;
  await writeTurn(turn);
  return true;
}
