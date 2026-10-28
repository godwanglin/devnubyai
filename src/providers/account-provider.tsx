"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ModelOption, UserProfile } from "@/types";

interface AccountContextType {
  /** Logged-in user, null when signed out. May come from the local cache while `stale`. */
  user: UserProfile | null;
  /** Active public catalog models from the DB (no gateway/upstream info). */
  models: ModelOption[];
  /** True until /api/v1/me has answered for this page load. */
  loading: boolean;
  /** True while showing cached data that /api/v1/me has not confirmed yet. */
  stale: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

interface AccountSnapshot {
  user: UserProfile | null;
  models: ModelOption[];
}

const AccountContext = createContext<AccountContextType | null>(null);

// ── Local cache: last confirmed account, shown instantly on reload ──────────
const CACHE_KEY = "devnuby-account";
const cacheListeners = new Set<() => void>();

function readCacheRaw(): string | null {
  try {
    return window.localStorage.getItem(CACHE_KEY);
  } catch {
    return null;
  }
}

function parseCache(raw: string | null): AccountSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AccountSnapshot>;
    return { user: parsed.user ?? null, models: Array.isArray(parsed.models) ? parsed.models : [] };
  } catch {
    return null;
  }
}

function writeCache(snapshot: AccountSnapshot) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // storage full or disabled — the live fetch still works
  }
  cacheListeners.forEach((listener) => listener());
}

function subscribeCache(listener: () => void) {
  cacheListeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === CACHE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    cacheListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

// ── Live data ───────────────────────────────────────────────────────────────
interface FetchResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
}

async function fetchData<T>(url: string): Promise<FetchResult<T>> {
  try {
    const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) {
      return { ok: false, status: res.status, data: null };
    }
    const body = (await res.json()) as { data: T };
    return { ok: true, status: res.status, data: body.data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

function loadAccount() {
  return Promise.all([
    fetchData<{ user: UserProfile | null }>("/api/v1/me"),
    fetchData<{ models: ModelOption[] }>("/api/v1/models"),
  ]);
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const cacheRaw = useSyncExternalStore(subscribeCache, readCacheRaw, () => null);
  const cached = useMemo(() => parseCache(cacheRaw), [cacheRaw]);
  /** Server-confirmed account; null until the first fetch completes. */
  const [live, setLive] = useState<AccountSnapshot | null>(null);

  const apply = useCallback(([meRes, catalogRes]: Awaited<ReturnType<typeof loadAccount>>) => {
    const previous = parseCache(readCacheRaw());

    // User resolution:
    // - 200 with data: authoritative, update cache
    // - 401: definitively unauthenticated, clear cached user
    // - Network error / 5xx: preserve cache to avoid accidental logout flickers
    let resolvedUser: UserProfile | null;
    if (meRes.ok) {
      resolvedUser = meRes.data?.user ?? null;
    } else if (meRes.status === 401) {
      resolvedUser = null;
    } else {
      resolvedUser = previous?.user ?? null;
    }

    let resolvedModels: ModelOption[];
    if (catalogRes.ok && catalogRes.data) {
      resolvedModels = catalogRes.data.models ?? [];
    } else {
      resolvedModels = previous?.models ?? [];
    }

    const next: AccountSnapshot = {
      user: resolvedUser,
      models: resolvedModels,
    };
    writeCache(next);
    setLive(next);
  }, []);

  const refresh = useCallback(async () => {
    apply(await loadAccount());
  }, [apply]);

  const logout = useCallback(async () => {
    await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    const next = { user: null, models: parseCache(readCacheRaw())?.models ?? [] };
    writeCache(next);
    setLive(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadAccount().then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const value = useMemo(() => {
    const source = live ?? cached;
    return {
      user: source?.user ?? null,
      models: source?.models ?? [],
      loading: live === null,
      stale: live === null && cached !== null,
      refresh,
      logout,
    };
  }, [live, cached, refresh, logout]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used within AccountProvider");
  return ctx;
}
