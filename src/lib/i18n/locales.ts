/**
 * Supported UI languages: the single place to add one. A new entry also needs
 * its dictionary in `src/messages/<code>.json`, registered in the i18n provider
 * (TypeScript fails the build until it is).
 */
export const LOCALES = [
  { code: "id", nativeName: "Bahasa Indonesia" },
  { code: "en", nativeName: "English" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

export const DEFAULT_LOCALE: Locale = "id";

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some((l) => l.code === value);
}

/** Best supported match for a browser language tag such as "id-ID" or "en-US". */
export function matchLocale(languageTag: string): Locale {
  const primary = languageTag.toLowerCase().split("-")[0];
  return LOCALES.find((l) => l.code === primary)?.code ?? "en";
}
