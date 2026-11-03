import { z } from "zod";
import { db } from "@/lib/db";
import { getCachedJson, setCachedJson, invalidateCacheKey } from "@/lib/redis/client";
import {
  DEFAULT_ABOUT_TEXT,
  DEFAULT_ABOUT_HIGHLIGHTS,
  DEFAULT_TERMS_SECTIONS,
  DEFAULT_PRIVACY_SECTIONS,
  DEFAULT_REFUND_SECTIONS,
} from "./defaults";

const legalSectionSchema = z.object({
  title: z.string(),
  body: z.string(),
});

export const legalSettingsSchema = z.object({
  companyName: z.string().min(1).default("Devnuby AI"),
  brandTagline: z.string().default("Platform Asisten AI Terpadu & Generator Dokumen"),
  entityLegalName: z.string().default("Devnuby Digital"),
  cityAddress: z.string().default("Jakarta, Indonesia"),
  supportEmail: z.string().email().default("support@devnuby.id"),
  supportWhatsappNumber: z.string().min(8).default("6281234567890"), // Numeric only for wa.me link
  supportWhatsappFormatted: z.string().default("+62 812-3456-7890"),
  operationalHours: z.string().default("Senin – Minggu, 09:00 – 22:00 WIB"),
  aboutText: z.string().default(DEFAULT_ABOUT_TEXT),
  aboutHighlights: z.array(legalSectionSchema).default(DEFAULT_ABOUT_HIGHLIGHTS),
  termsSections: z.array(legalSectionSchema).default(DEFAULT_TERMS_SECTIONS),
  privacySections: z.array(legalSectionSchema).default(DEFAULT_PRIVACY_SECTIONS),
  refundSections: z.array(legalSectionSchema).default(DEFAULT_REFUND_SECTIONS),
  lastUpdatedDate: z.string().default("3 November 2026"),
});

export type LegalSettings = z.infer<typeof legalSettingsSchema>;
export type LegalSectionItem = z.infer<typeof legalSectionSchema>;

export const DEFAULT_LEGAL_SETTINGS: LegalSettings = legalSettingsSchema.parse({});

const LEGAL_APP_SETTING_KEY = "legal.pages";
const REDIS_LEGAL_KEY = "cache:legal:pages";
const LEGAL_CACHE_TTL = 3600; // 1 hour

/**
 * Fetch legal page configurations with Redis caching and PostgreSQL fallback.
 */
export async function getLegalSettings(options?: { forceRefresh?: boolean }): Promise<LegalSettings> {
  if (!options?.forceRefresh) {
    const cached = await getCachedJson<LegalSettings>(REDIS_LEGAL_KEY);
    if (cached) return cached;
  }

  try {
    const row = await db.appSetting.findUnique({
      where: { settingKey: LEGAL_APP_SETTING_KEY },
      select: { value: true },
    });

    if (!row || !row.value) {
      await db.appSetting.upsert({
        where: { settingKey: LEGAL_APP_SETTING_KEY },
        create: {
          settingKey: LEGAL_APP_SETTING_KEY,
          value: DEFAULT_LEGAL_SETTINGS,
        },
        update: {},
      });
      await setCachedJson(REDIS_LEGAL_KEY, DEFAULT_LEGAL_SETTINGS, LEGAL_CACHE_TTL);
      return DEFAULT_LEGAL_SETTINGS;
    }

    const parsed = legalSettingsSchema.safeParse(row.value);
    const data = parsed.success ? parsed.data : DEFAULT_LEGAL_SETTINGS;
    await setCachedJson(REDIS_LEGAL_KEY, data, LEGAL_CACHE_TTL);
    return data;
  } catch (err) {
    console.error("Failed to read legal settings:", err);
    return DEFAULT_LEGAL_SETTINGS;
  }
}

/**
 * Update legal page configurations (Admin only) and clear Redis cache.
 */
export async function updateLegalSettings(
  input: Partial<LegalSettings>,
  userId?: bigint | null
): Promise<LegalSettings> {
  const current = await getLegalSettings();
  const merged = legalSettingsSchema.parse({
    ...current,
    ...input,
  });

  await db.appSetting.upsert({
    where: { settingKey: LEGAL_APP_SETTING_KEY },
    create: {
      settingKey: LEGAL_APP_SETTING_KEY,
      value: merged,
      updatedBy: userId ?? null,
    },
    update: {
      value: merged,
      updatedBy: userId ?? null,
    },
  });

  await invalidateCacheKey(REDIS_LEGAL_KEY);
  await setCachedJson(REDIS_LEGAL_KEY, merged, LEGAL_CACHE_TTL);
  return merged;
}

export function buildWhatsappLink(phone: string, defaultMessage?: string): string {
  const clean = phone.replace(/[^0-9]/g, "");
  const msg = encodeURIComponent(
    defaultMessage || "Halo Tim Support Devnuby AI, saya ingin bertanya terkait layanan..."
  );
  return `https://wa.me/${clean}?text=${msg}`;
}
