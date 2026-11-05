import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { getCachedJson, setCachedJson, invalidateCacheKey } from "@/lib/redis/client";

/**
 * Which catalog model serves `generate_image` is admin policy stored in
 * app_settings. There is deliberately no in-code default: an unset key means
 * image generation is not configured yet.
 */
export const IMAGE_CATALOG_SETTING_KEY = "image.catalog_model";

/** Ordered catalog models tried when the primary model's routes all fail. */
export const IMAGE_FALLBACK_SETTING_KEY = "image.fallback_models";

/** Catalog category reserved for image models; hidden from the chat model picker. */
export const IMAGE_CATALOG_CATEGORY = "image";

export interface ImageSettings {
  catalogModelId: string | null;
  fallbackModelIds: string[];
}

const REDIS_IMAGE_SETTINGS_KEY = "cache:image:settings";
const IMAGE_SETTINGS_TTL = 3600; // 1 hour

export async function getImageSettings(options?: { forceRefresh?: boolean }): Promise<ImageSettings> {
  if (!options?.forceRefresh) {
    const cached = await getCachedJson<Partial<ImageSettings>>(REDIS_IMAGE_SETTINGS_KEY);
    // Entries cached before the fallback chain existed have no fallbackModelIds
    if (cached) return parseImageSettings(cached.catalogModelId, cached.fallbackModelIds);
  }

  const rows = await db.appSetting.findMany({
    where: { settingKey: { in: [IMAGE_CATALOG_SETTING_KEY, IMAGE_FALLBACK_SETTING_KEY] } },
    select: { settingKey: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.settingKey, r.value]));
  const settings = parseImageSettings(byKey.get(IMAGE_CATALOG_SETTING_KEY), byKey.get(IMAGE_FALLBACK_SETTING_KEY));
  await setCachedJson(REDIS_IMAGE_SETTINGS_KEY, settings, IMAGE_SETTINGS_TTL);
  return settings;
}

/** Reads the two setting rows into one object, dropping anything malformed. */
export function parseImageSettings(catalogValue: unknown, fallbackValue: unknown): ImageSettings {
  const catalogModelId = typeof catalogValue === "string" && catalogValue.trim() ? catalogValue.trim() : null;
  const fallbackModelIds = Array.isArray(fallbackValue)
    ? [...new Set(fallbackValue.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim()))]
    : [];
  return {
    catalogModelId,
    // The primary model is tried first on its own; listing it again would repeat its routes
    fallbackModelIds: fallbackModelIds.filter((id) => id !== catalogModelId),
  };
}

/** Saves the primary image model and its fallback chain after checking every id. */
export async function updateImageSettings(
  catalogModelId: string,
  userId?: bigint | null,
  fallbackModelIds: string[] = []
): Promise<ImageSettings> {
  const publicId = catalogModelId.trim();
  const fallbackIds = [...new Set(fallbackModelIds.map((id) => id.trim()).filter(Boolean))].filter(
    (id) => id !== publicId
  );
  await assertImageModels([publicId, ...fallbackIds]);

  await db.$transaction([
    db.appSetting.upsert({
      where: { settingKey: IMAGE_CATALOG_SETTING_KEY },
      create: { settingKey: IMAGE_CATALOG_SETTING_KEY, value: publicId, updatedBy: userId ?? null },
      update: { value: publicId, updatedBy: userId ?? null },
    }),
    db.appSetting.upsert({
      where: { settingKey: IMAGE_FALLBACK_SETTING_KEY },
      create: { settingKey: IMAGE_FALLBACK_SETTING_KEY, value: fallbackIds, updatedBy: userId ?? null },
      update: { value: fallbackIds, updatedBy: userId ?? null },
    }),
  ]);

  const updated: ImageSettings = { catalogModelId: publicId, fallbackModelIds: fallbackIds };
  await invalidateCacheKey(REDIS_IMAGE_SETTINGS_KEY);
  await setCachedJson(REDIS_IMAGE_SETTINGS_KEY, updated, IMAGE_SETTINGS_TTL);
  return updated;
}

/** Every id must be an active catalog model of the image category. */
async function assertImageModels(publicIds: string[]): Promise<void> {
  const models = await db.catalogModel.findMany({
    where: { publicId: { in: publicIds } },
    select: { publicId: true, status: true, category: true },
  });
  const byId = new Map(models.map((m) => [m.publicId, m]));
  for (const publicId of publicIds) {
    const model = byId.get(publicId);
    if (!model) throw ApiError.badRequest(`Catalog model '${publicId}' tidak ditemukan`);
    if (model.category !== IMAGE_CATALOG_CATEGORY) {
      throw ApiError.badRequest(`Catalog model '${publicId}' bukan kategori '${IMAGE_CATALOG_CATEGORY}'`);
    }
    if (model.status !== "active") throw ApiError.badRequest(`Catalog model '${publicId}' belum aktif`);
  }
}

/** Active image-category catalog models, for the admin selector. */
export async function listImageCatalogModels(): Promise<Array<{ publicId: string; displayName: string; routeCount: number }>> {
  const models = await db.catalogModel.findMany({
    where: { category: IMAGE_CATALOG_CATEGORY, status: "active" },
    orderBy: [{ sortOrder: "asc" }, { displayName: "asc" }],
    select: { publicId: true, displayName: true, _count: { select: { routes: { where: { isEnabled: true } } } } },
  });
  return models.map((m) => ({ publicId: m.publicId, displayName: m.displayName, routeCount: m._count.routes }));
}
