/**
 * In-process registry of running generations so `/stop` can abort the upstream
 * request even when the client keeps the SSE connection open.
 * Keyed by assistant message public id. Single-instance only; a multi-instance
 * deployment needs a shared channel (Phase 6).
 */
const active = new Map<string, AbortController>();

export function registerStream(messagePublicId: string): AbortController {
  active.get(messagePublicId)?.abort();
  const controller = new AbortController();
  active.set(messagePublicId, controller);
  return controller;
}

export function unregisterStream(messagePublicId: string, controller: AbortController): void {
  if (active.get(messagePublicId) === controller) active.delete(messagePublicId);
}

/** Whether this process is running the generation of that reply. */
export function isStreamActive(messagePublicId: string): boolean {
  return active.has(messagePublicId);
}

/** Returns true when a running generation was found and aborted. */
export function abortStream(messagePublicId: string): boolean {
  const controller = active.get(messagePublicId);
  if (!controller) return false;
  controller.abort();
  active.delete(messagePublicId);
  return true;
}
