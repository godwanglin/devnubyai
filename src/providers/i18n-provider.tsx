"use client";

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";
import type { Locale } from "@/types";
import idDict from "@/messages/id.json";
import enDict from "@/messages/en.json";

type Dictionary = typeof idDict;

interface I18nContextType {
  locale: Locale;
  /** False until the saved/browser locale has been read (first render always uses "id") */
  isReady: boolean;
  setLocale: (loc: Locale) => void;
  t: (path: string, params?: Record<string, string | number>) => string;
}

const dictionaries: Record<Locale, Dictionary> = {
  id: idDict,
  en: enDict,
};

const I18nContext = createContext<I18nContextType | null>(null);

const STORAGE_KEY = "devnuby-locale";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("id");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
      if (saved === "id" || saved === "en") {
        setLocaleState(saved);
      } else {
        const browser = navigator.language.toLowerCase().startsWith("id") ? "id" : "en";
        setLocaleState(browser);
      }
    } catch {}
    setIsReady(true);
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(STORAGE_KEY, newLocale);
      document.documentElement.lang = newLocale;
    } catch {}
  }, []);

  const t = useCallback(
    (path: string, params?: Record<string, string | number>): string => {
      const dict = dictionaries[locale] || dictionaries.id;
      const parts = path.split(".");
      let current: any = dict;
      for (const part of parts) {
        if (current && typeof current === "object" && part in current) {
          current = current[part];
        } else {
          return path;
        }
      }
      if (typeof current !== "string") {
        return path;
      }
      if (!params) return current;
      return Object.entries(params).reduce((acc, [k, v]) => {
        return acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }, current);
    },
    [locale]
  );

  const value = useMemo(() => ({ locale, isReady, setLocale, t }), [locale, isReady, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}
