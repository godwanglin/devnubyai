"use client";

import { getLocalStorage, setLocalStorage } from "@/lib/storage";
import type { SessionGroupKey } from "@/types";

export const COLLAPSED_GROUPS_KEY = "devnuby-collapsed-groups";
export const EMPTY_COLLAPSED: Partial<Record<SessionGroupKey, boolean>> = {};
let cachedCollapsedRaw: string | null = null;
let cachedCollapsedObj: Partial<Record<SessionGroupKey, boolean>> = EMPTY_COLLAPSED;
const groupListeners = new Set<() => void>();

export function subscribeCollapsedGroups(listener: () => void) {
  groupListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    groupListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function readCollapsedGroups(): Partial<Record<SessionGroupKey, boolean>> {
  if (typeof window === "undefined") return EMPTY_COLLAPSED;
  try {
    const raw = window.localStorage.getItem(COLLAPSED_GROUPS_KEY);
    if (raw === cachedCollapsedRaw) return cachedCollapsedObj;
    cachedCollapsedRaw = raw;
    cachedCollapsedObj = raw ? JSON.parse(raw) : EMPTY_COLLAPSED;
    return cachedCollapsedObj;
  } catch {
    return EMPTY_COLLAPSED;
  }
}

export function updateCollapsedGroup(key: SessionGroupKey, collapsed: boolean) {
  const current = getLocalStorage<Partial<Record<SessionGroupKey, boolean>>>(
    COLLAPSED_GROUPS_KEY,
    {}
  );
  const next = { ...current, [key]: collapsed };
  setLocalStorage(COLLAPSED_GROUPS_KEY, next);
  groupListeners.forEach((l) => l());
}

export function ensureGroupExpanded(key: SessionGroupKey) {
  const current = readCollapsedGroups();
  if (current[key]) {
    updateCollapsedGroup(key, false);
  }
}
