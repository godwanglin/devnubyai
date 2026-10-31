import type { UIMessageChunk } from "ai";

/**
 * In-process buffer of running generations, keyed by chat public id.
 * The generation is pumped to completion on the server regardless of who is
 * listening, so a page reload only drops a subscriber: the client reconnects
 * and gets the response replayed from the first chunk. Single-instance only,
 * like active-streams.ts.
 */
interface StreamHub {
  messageId: string;
  chunks: UIMessageChunk[];
  done: boolean;
  listeners: Set<() => void>;
}

/** Keep finished hubs briefly so a reload right at the end still replays. */
const FINISHED_TTL_MS = 15_000;

// Survives dev HMR module reloads so in-flight generations stay reachable
const globalHubs = globalThis as unknown as { __chatStreamHubs?: Map<string, StreamHub> };
const hubs = (globalHubs.__chatStreamHubs ??= new Map<string, StreamHub>());

function subscribe(hub: StreamHub): ReadableStream<UIMessageChunk> {
  let flush: (() => void) | null = null;
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      let index = 0;
      flush = () => {
        try {
          while (index < hub.chunks.length) controller.enqueue(hub.chunks[index++]);
          if (hub.done) {
            hub.listeners.delete(flush!);
            controller.close();
          }
        } catch {
          // Subscriber already gone
          hub.listeners.delete(flush!);
        }
      };
      hub.listeners.add(flush);
      flush();
    },
    cancel() {
      if (flush) hub.listeners.delete(flush);
    },
  });
}

/** Starts pumping `source` in the background and returns the first subscriber stream. */
export function startStreamHub(
  chatPublicId: string,
  messagePublicId: string,
  source: ReadableStream<UIMessageChunk>
): ReadableStream<UIMessageChunk> {
  const hub: StreamHub = { messageId: messagePublicId, chunks: [], done: false, listeners: new Set() };
  hubs.set(chatPublicId, hub);

  const notify = () => hub.listeners.forEach((listener) => listener());

  void (async () => {
    const reader = source.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        hub.chunks.push(value);
        notify();
      }
    } catch (err) {
      hub.chunks.push({
        type: "error",
        errorText: err instanceof Error ? err.message : "Stream interrupted",
      });
    } finally {
      hub.done = true;
      notify();
      setTimeout(() => {
        if (hubs.get(chatPublicId) === hub) hubs.delete(chatPublicId);
      }, FINISHED_TTL_MS);
    }
  })();

  return subscribe(hub);
}

/** Replays the chat's running (or just finished) generation, or null when there is none. */
export function resumeStreamHub(chatPublicId: string): ReadableStream<UIMessageChunk> | null {
  const hub = hubs.get(chatPublicId);
  return hub ? subscribe(hub) : null;
}
