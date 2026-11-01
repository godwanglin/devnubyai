import { z } from "zod";
import homeDefaults from "@/data/home-defaults.json";
import type { Locale, QuickPrompt } from "@/types";

/** Client-safe part of the personalized home suggestions (no DB access). */
export const HOME_HEADLINE_COUNT = 10;
export const HOME_PROMPT_COUNT = 4;

export const homeSuggestionsSchema = z.object({
  headlines: z.array(z.string().trim().min(2).max(90)).min(3).max(HOME_HEADLINE_COUNT),
  prompts: z
    .array(
      z.object({
        label: z.string().trim().min(2).max(80),
        prompt: z.string().trim().min(2).max(500),
      })
    )
    .length(HOME_PROMPT_COUNT),
});

export interface HomeSuggestions {
  headlines: string[];
  prompts: QuickPrompt[];
}

export const HOME_LOCALES: readonly Locale[] = ["id", "en"];

export function isHomeLocale(value: unknown): value is Locale {
  return typeof value === "string" && (HOME_LOCALES as readonly string[]).includes(value);
}

/** Static content shown until (or instead of) the AI-personalized suggestions */
export function getDefaultHomeSuggestions(locale: Locale): HomeSuggestions {
  return (homeDefaults as Record<Locale, HomeSuggestions>)[locale] ?? homeDefaults.id;
}
