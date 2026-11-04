import { getCachedJson, invalidateCacheKey, setCachedJson } from "@/lib/redis/client";

/**
 * The last messages of a chat as the gateway history uses them (quotes, @mentions
 * and produced-file notes already folded into `content`; no session-memory note),
 * so a turn can start without reading Postgres. Appended when a turn ends and
 * invalidated whenever stored messages are edited, deleted or regenerated.
 */
export interface HistoryEntry {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

const HISTORY_CACHE_TTL = 7200; // 2 hours of idle chat
const historyKey = (sessionId: bigint) => `chat:history:${sessionId}`;

export async function readCachedHistory(
  sessionId: bigint,
  takeCount: number
): Promise<HistoryEntry[] | null> {
  const cached = await getCachedJson<HistoryEntry[]>(historyKey(sessionId));
  if (!cached) return null;
  return cached.slice(-takeCount);
}

export async function writeCachedHistory(sessionId: bigint, entries: HistoryEntry[]): Promise<void> {
  await setCachedJson(historyKey(sessionId), entries, HISTORY_CACHE_TTL);
}

/** Adds a turn to the cached tail when it exists; a cold cache is left cold. */
export async function appendCachedHistory(sessionId: bigint, entries: HistoryEntry[]): Promise<void> {
  const cached = await getCachedJson<HistoryEntry[]>(historyKey(sessionId));
  if (!cached) return;
  await writeCachedHistory(sessionId, [...cached, ...entries].slice(-60));
}

export async function invalidateHistoryCache(sessionId: bigint): Promise<void> {
  await invalidateCacheKey(historyKey(sessionId));
}
