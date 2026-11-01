"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/providers/i18n-provider";
import {
  getDefaultHomeSuggestions,
  type HomeSuggestions,
} from "@/lib/chat/home-suggestions-shared";
import type { Locale } from "@/types";

/** How long the home waits for stored suggestions before settling on the defaults */
const SETTLE_TIMEOUT_MS = 500;

// Fetched once per locale per page load: going back to home doesn't refetch or flash
const sessionCache = new Map<Locale, HomeSuggestions | null>();

/**
 * Personalized home headlines + quick prompts. Shows the static defaults whenever the
 * personalized set isn't available yet; the server regenerates stale sets in the
 * background, so a later page load picks them up. Never swaps content mid-view: a
 * reply that arrives after the settle timeout is only cached for the next visit.
 */
export function useHomeSuggestions() {
  const { locale, isReady } = useI18n();
  const [result, setResult] = useState<{ locale: Locale; data: HomeSuggestions | null } | null>(null);
  const timedOutRef = useRef<Locale | null>(null);

  useEffect(() => {
    if (!isReady || sessionCache.has(locale)) return;
    let active = true;
    timedOutRef.current = null;

    const timer = setTimeout(() => {
      if (!active) return;
      timedOutRef.current = locale;
      setResult({ locale, data: null });
    }, SETTLE_TIMEOUT_MS);

    fetch(`/api/v1/me/home-suggestions?locale=${locale}`, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const s = json?.data?.suggestions;
        const data: HomeSuggestions | null =
          s && Array.isArray(s.headlines) && Array.isArray(s.prompts) && s.headlines.length > 0
            ? { headlines: s.headlines, prompts: s.prompts }
            : null;
        sessionCache.set(locale, data);
        if (active && timedOutRef.current !== locale) setResult({ locale, data });
      })
      .catch(() => {
        if (active && timedOutRef.current !== locale) setResult({ locale, data: null });
      })
      .finally(() => clearTimeout(timer));

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [locale, isReady]);

  const hasCached = isReady && sessionCache.has(locale) && result?.locale !== locale;
  const data = hasCached
    ? sessionCache.get(locale) ?? null
    : result?.locale === locale
      ? result.data
      : null;

  return {
    suggestions: data ?? getDefaultHomeSuggestions(locale),
    isPersonalized: Boolean(data),
    /** False while waiting (briefly) for the stored set, so defaults don't flash first */
    isSettled: hasCached || result?.locale === locale,
  };
}
