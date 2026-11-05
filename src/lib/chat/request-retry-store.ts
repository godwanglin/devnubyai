"use client";

import { useSyncExternalStore } from "react";

/**
 * The retry attempt of each chat's running request ("attempt 2/5"), fed by the
 * transient `data-request-retry` stream part and cleared when the request ends.
 */
export interface RequestRetryState {
  attempt: number;
  max: number;
}

const states = new Map<string, RequestRetryState>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function setRequestRetry(chatId: string, state: RequestRetryState): void {
  states.set(chatId, state);
  emit();
}

export function clearRequestRetry(chatId: string): void {
  if (states.delete(chatId)) emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current retry attempt of a chat's running request, or null when on its first try. */
export function useRequestRetry(chatId: string | undefined): RequestRetryState | null {
  return useSyncExternalStore(
    subscribe,
    () => (chatId ? states.get(chatId) ?? null : null),
    () => null
  );
}

/** Reads a `data-request-retry` part; null for anything else or a malformed payload. */
export function parseRequestRetryPart(part: { type: string; data?: unknown }): RequestRetryState | null {
  if (part.type !== "data-request-retry") return null;
  const data = (part.data ?? {}) as Record<string, unknown>;
  const attempt = Number(data.attempt);
  const max = Number(data.max);
  return Number.isInteger(attempt) && Number.isInteger(max) && attempt >= 1 && max >= attempt
    ? { attempt, max }
    : null;
}
