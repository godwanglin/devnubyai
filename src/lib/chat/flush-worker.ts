import { redis } from "@/lib/redis/client";
import { isStreamActive } from "./active-streams";
import { drainPendingFlushes, recoverStaleTurns } from "./redis-chat-state";

/**
 * Background loop that stores chat turns Postgres could not take at turn end
 * (busy / down) and closes turns orphaned by a dead process. Started once per
 * server from `instrumentation.ts`; a Redis lock keeps instances from racing.
 */
const INTERVAL_MS = 15_000;
const LOCK_KEY = "chat:flush-worker:lock";

const globalForWorker = globalThis as unknown as { chatFlushWorker?: NodeJS.Timeout };

async function tick(): Promise<void> {
  if (redis) {
    const locked = await redis.set(LOCK_KEY, "1", "PX", INTERVAL_MS - 1000, "NX").catch(() => null);
    if (locked !== "OK") return;
  }
  try {
    const recovered = await recoverStaleTurns(isStreamActive);
    const { processed, succeeded } = await drainPendingFlushes(25);
    if (recovered > 0 || processed > 0) {
      console.info(
        `[CHAT_FLUSH_WORKER] recovered=${recovered} pending=${processed} stored=${succeeded}`
      );
    }
  } catch (err) {
    console.error("[CHAT_FLUSH_WORKER_ERROR]", err);
  }
}

export function startChatFlushWorker(): void {
  if (globalForWorker.chatFlushWorker) return;
  const timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref?.();
  globalForWorker.chatFlushWorker = timer;
}
