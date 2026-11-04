/**
 * Runs once when a Next.js server instance starts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startChatFlushWorker } = await import("@/lib/chat/flush-worker");
    startChatFlushWorker();
  }
}
