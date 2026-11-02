import { z } from "zod";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/lib/i18n/locales";

/**
 * "Capacity & Quotas" list on a plan card, fully admin-managed (stored in
 * `plans.features`). Two kinds of rows:
 * - auto: the number comes from the plan settings; the text defaults to the i18n
 *   files but the admin may override it per language ({value} = the number).
 * - custom: free text the admin writes, one string per UI language.
 * Isomorphic: shared by the admin form, the plans service and the public card.
 */
export const AUTO_FEATURE_KEYS = ["usage", "dailyRequests", "requestsPerMinute"] as const;
export type AutoFeatureKey = (typeof AUTO_FEATURE_KEYS)[number];

export const DEFAULT_FEATURE_ICON = "check";
export const MAX_PLAN_FEATURES = 30;
export const MAX_FEATURE_TEXT = 120;

export type LocalizedText = Partial<Record<Locale, string>>;

export type PlanFeature =
  | { id: string; type: "auto"; key: AutoFeatureKey; icon: string; visible: boolean; text?: LocalizedText }
  | { id: string; type: "custom"; icon: string; text: LocalizedText };

const localeCodes = LOCALES.map((l) => l.code) as [Locale, ...Locale[]];

const iconSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "Invalid icon name");

/** `{ id: "...", en: "..." }`; keys that are not a supported locale are dropped. */
export const localizedTextSchema = z
  .record(z.string(), z.string().trim().max(MAX_FEATURE_TEXT))
  .transform((record): LocalizedText => {
    const text: LocalizedText = {};
    for (const code of localeCodes) {
      if (typeof record[code] === "string") text[code] = record[code];
    }
    return text;
  });

export const planFeatureSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().trim().min(1).max(40),
    type: z.literal("auto"),
    key: z.enum(AUTO_FEATURE_KEYS),
    icon: iconSchema,
    visible: z.boolean(),
    text: localizedTextSchema.optional(),
  }),
  z.object({
    id: z.string().trim().min(1).max(40),
    type: z.literal("custom"),
    icon: iconSchema,
    text: localizedTextSchema,
  }),
]);

export const planFeaturesSchema = z.array(planFeatureSchema).max(MAX_PLAN_FEATURES);

export function defaultAutoFeature(key: AutoFeatureKey): PlanFeature {
  return { id: `auto-${key}`, type: "auto", key, icon: DEFAULT_FEATURE_ICON, visible: true };
}

/**
 * Reads whatever is stored (null for plans saved before this existed, or rows
 * written by older code) into a clean list: invalid rows dropped, custom rows
 * without any text dropped, and each auto row at most once. Plans with nothing
 * stored yet get every auto row; a saved list keeps the auto rows the admin removed out.
 */
export function normalizePlanFeatures(raw: unknown): PlanFeature[] {
  const rows = Array.isArray(raw) ? raw : [];
  const result: PlanFeature[] = [];
  const seenAuto = new Set<AutoFeatureKey>();
  const seenIds = new Set<string>();

  for (const row of rows) {
    const parsed = planFeatureSchema.safeParse(row);
    if (!parsed.success || seenIds.has(parsed.data.id)) continue;
    const feature = parsed.data as PlanFeature;
    if (feature.type === "auto") {
      if (seenAuto.has(feature.key)) continue;
      seenAuto.add(feature.key);
    } else if (!hasAnyText(feature.text)) {
      continue;
    }
    seenIds.add(feature.id);
    result.push(feature);
  }

  if (!Array.isArray(raw)) {
    for (const key of AUTO_FEATURE_KEYS) {
      if (!seenAuto.has(key)) result.push(defaultAutoFeature(key));
    }
  }
  return result.slice(0, MAX_PLAN_FEATURES);
}

export function hasAnyText(text: LocalizedText): boolean {
  return Object.values(text).some((v) => typeof v === "string" && v.trim().length > 0);
}

/** Text in the user's language, else the default language, else any language filled in. */
export function resolveLocalizedText(text: LocalizedText, locale: Locale): string {
  const pick = (l: Locale) => text[l]?.trim();
  return (
    pick(locale) ||
    pick(DEFAULT_LOCALE) ||
    Object.values(text).find((v): v is string => typeof v === "string" && v.trim().length > 0)?.trim() ||
    ""
  );
}

export function newCustomFeatureId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Fills `{value}` / `{base}` in an admin-written auto-row text. */
export function fillFeatureTemplate(template: string, vars: { value: string; base?: string }): string {
  return template.replace(/\{value\}/g, vars.value).replace(/\{base\}/g, vars.base ?? "");
}
