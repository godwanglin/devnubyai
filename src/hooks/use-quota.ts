"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { UserQuota } from "@/types";

/**
 * Quota lives apart from /api/v1/me so the account bootstrap stays fast.
 * One shared store: every consumer reads the same snapshot and a single
 * in-flight request is reused.
 */
let snapshot: UserQuota | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function refreshQuota(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/v1/me/quota", { credentials: "same-origin", cache: "no-store" });
      if (res.status === 401) {
        snapshot = null;
      } else if (res.ok) {
        const body = (await res.json()) as { data?: { quota?: UserQuota } };
        snapshot = body.data?.quota ?? null;
      }
      // other failures keep the last snapshot
    } catch {
      // network error: keep the last snapshot
    } finally {
      inflight = null;
      emit();
    }
  })();
  return inflight;
}

/** Quota for the signed-in user; fetched on first use when `enabled`. */
export function useQuota(enabled = true) {
  const quota = useSyncExternalStore(subscribe, () => snapshot, () => null);

  useEffect(() => {
    if (enabled && snapshot === null) void refreshQuota();
  }, [enabled]);

  const refresh = useCallback(() => refreshQuota(), []);
  return { quota: enabled ? quota : null, refresh };
}
