"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/providers/i18n-provider";
import {
  getDefaultHomeSuggestions,
  type HomeSuggestions,
} from "@/lib/chat/home-suggestions-shared";
import type { Locale } from "@/types";

/** How long the headline waits for the stored set before typing the defaults */
const SETTLE_TIMEOUT_MS = 500;
/** After a profile change the server regenerates in the background; poll until it's done */
const REBUILD_POLL_MS = 2500;
const REBUILD_TIMEOUT_MS = 60_000;
const STALE_EVENT = "devnuby:home-suggestions-stale";

// Fetched once per locale per page load: going back to home doesn't refetch or flash
const sessionCache = new Map<Locale, HomeSuggestions | null>();

/**
 * Call after the user's profile changed (onboarding finished): forgets this page
 * load's suggestions and has a mounted home wait for the freshly generated set.
 */
export function markHomeSuggestionsStale(): void {
  sessionCache.clear();
  window.dispatchEvent(new CustomEvent(STALE_EVENT));
}

async function fetchSuggestions(locale: Locale): Promise<HomeSuggestions | null> {
  const res = await fetch(`/api/v1/me/home-suggestions?locale=${locale}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) return null;
  const s = (await res.json())?.data?.suggestions;
  return s && Array.isArray(s.headlines) && Array.isArray(s.prompts) && s.headlines.length > 0
    ? { headlines: s.headlines, prompts: s.prompts }
    : null;
}

/**
 * Personalized home headlines + quick prompts.
 * - Quick prompts only ever come from the server: skeletons while fetching, nothing
 *   at all when the user has no personalized set yet (no hardcoded fallback).
 * - Headlines fall back to the static defaults, so the greeting is never empty.
 * Right after a profile change, the new set replaces the old one as soon as the
 * server has built it.
 */
export function useHomeSuggestions() {
  const { locale, isReady } = useI18n();
  const [result, setResult] = useState<{ locale: Locale; data: HomeSuggestions | null } | null>(null);
  const [timedOutLocale, setTimedOutLocale] = useState<Locale | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  // Bumped whenever a new set replaces the shown one, so cards re-animate in
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!isReady || sessionCache.has(locale)) return;
    let active = true;
    const timer = setTimeout(() => active && setTimedOutLocale(locale), SETTLE_TIMEOUT_MS);

    fetchSuggestions(locale)
      .catch(() => null)
      .then((data) => {
        sessionCache.set(locale, data);
        if (active) setResult({ locale, data });
      })
      .finally(() => clearTimeout(timer));

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [locale, isReady]);

  // Profile changed: skeletons until the regenerated set exists (or give up and hide)
  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function onStale() {
      clearTimeout(timer);
      const startedAt = Date.now();
      setRebuilding(true);

      const poll = async () => {
        const data = await fetchSuggestions(locale).catch(() => null);
        if (cancelled) return;
        const gaveUp = Date.now() - startedAt > REBUILD_TIMEOUT_MS;
        if (data || gaveUp) {
          sessionCache.set(locale, data);
          setResult({ locale, data });
          setVersion((v) => v + 1);
          setRebuilding(false);
          return;
        }
        timer = setTimeout(() => void poll(), REBUILD_POLL_MS);
      };
      timer = setTimeout(() => void poll(), REBUILD_POLL_MS);
    }

    window.addEventListener(STALE_EVENT, onStale);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener(STALE_EVENT, onStale);
    };
  }, [locale, isReady]);

  const cached = isReady && sessionCache.has(locale);
  const loaded = result?.locale === locale || cached;
  const data = result?.locale === locale ? result.data : cached ? sessionCache.get(locale) ?? null : null;
  const isLoadingPrompts = rebuilding || !loaded;

  return {
    headlines: data?.headlines ?? getDefaultHomeSuggestions(locale).headlines,
    /** Quick prompts, or null when there is no personalized set (hide the section) */
    prompts: isLoadingPrompts ? null : data?.prompts.length ? data.prompts : null,
    /** Show skeletons: the first fetch or a rebuild after a profile change is running */
    isLoadingPrompts,
    /** True while new suggestions are being built after a profile change */
    isRebuilding: rebuilding,
    isPersonalized: Boolean(data),
    /** False while waiting (briefly) for the stored set, so default headlines don't flash first */
    isSettled: loaded || timedOutLocale === locale,
    /** Changes whenever the shown set is replaced */
    version,
  };
}
