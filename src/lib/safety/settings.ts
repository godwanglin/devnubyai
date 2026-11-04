import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { IMAGE_CATALOG_CATEGORY } from "@/lib/images/settings";
import { getCachedJson, invalidateCacheKey, setCachedJson } from "@/lib/redis/client";

/**
 * Which catalog model screens user requests before they reach the chat model is admin
 * policy stored in app_settings. There is deliberately no in-code default: an unset
 * (or empty) key means the safety gate is off.
 */
export const SAFETY_CLASSIFIER_SETTING_KEY = "safety.classifier_model";

export interface SafetySettings {
  /** Catalog model public id, or null when the gate is disabled */
  classifierModelId: string | null;
}

const REDIS_SAFETY_SETTINGS_KEY = "cache:safety:settings";
const SAFETY_SETTINGS_TTL = 3600; // 1 hour

export async function getSafetySettings(options?: { forceRefresh?: boolean }): Promise<SafetySettings> {
  if (!options?.forceRefresh) {
    const cached = await getCachedJson<SafetySettings>(REDIS_SAFETY_SETTINGS_KEY);
    if (cached) return cached;
  }

  const row = await db.appSetting.findUnique({
    where: { settingKey: SAFETY_CLASSIFIER_SETTING_KEY },
    select: { value: true },
  });
  const value = typeof row?.value === "string" ? row.value.trim() : "";
  const settings: SafetySettings = { classifierModelId: value || null };
  await setCachedJson(REDIS_SAFETY_SETTINGS_KEY, settings, SAFETY_SETTINGS_TTL);
  return settings;
}

/** Saves the classifier model (or `null` to turn the gate off) after checking it is an active chat model. */
export async function updateSafetySettings(
  classifierModelId: string | null,
  userId?: bigint | null
): Promise<SafetySettings> {
  const publicId = classifierModelId?.trim() || "";
  if (publicId) {
    const model = await db.catalogModel.findUnique({
      where: { publicId },
      select: { status: true, category: true },
    });
    if (!model) throw ApiError.badRequest(`Catalog model '${publicId}' tidak ditemukan`);
    if (model.category === IMAGE_CATALOG_CATEGORY) {
      throw ApiError.badRequest(`Catalog model '${publicId}' adalah model gambar, bukan model teks`);
    }
    if (model.status !== "active") throw ApiError.badRequest(`Catalog model '${publicId}' belum aktif`);
  }

  await db.appSetting.upsert({
    where: { settingKey: SAFETY_CLASSIFIER_SETTING_KEY },
    create: { settingKey: SAFETY_CLASSIFIER_SETTING_KEY, value: publicId, updatedBy: userId ?? null },
    update: { value: publicId, updatedBy: userId ?? null },
  });

  const updated: SafetySettings = { classifierModelId: publicId || null };
  await invalidateCacheKey(REDIS_SAFETY_SETTINGS_KEY);
  await setCachedJson(REDIS_SAFETY_SETTINGS_KEY, updated, SAFETY_SETTINGS_TTL);
  return updated;
}

/** Active text catalog models, for the admin selector. */
export async function listSafetyClassifierModels(): Promise<
  Array<{ publicId: string; displayName: string; routeCount: number }>
> {
  const models = await db.catalogModel.findMany({
    where: { category: { not: IMAGE_CATALOG_CATEGORY }, status: "active" },
    orderBy: [{ sortOrder: "asc" }, { displayName: "asc" }],
    select: { publicId: true, displayName: true, _count: { select: { routes: { where: { isEnabled: true } } } } },
  });
  return models.map((m) => ({ publicId: m.publicId, displayName: m.displayName, routeCount: m._count.routes }));
}
