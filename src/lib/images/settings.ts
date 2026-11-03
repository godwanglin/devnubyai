import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { getCachedJson, setCachedJson, invalidateCacheKey } from "@/lib/redis/client";

/**
 * Which catalog model serves `generate_image` is admin policy stored in
 * app_settings. There is deliberately no in-code default: an unset key means
 * image generation is not configured yet.
 */
export const IMAGE_CATALOG_SETTING_KEY = "image.catalog_model";

/** Catalog category reserved for image models; hidden from the chat model picker. */
export const IMAGE_CATALOG_CATEGORY = "image";

export interface ImageSettings {
  catalogModelId: string | null;
}

const REDIS_IMAGE_SETTINGS_KEY = "cache:image:settings";
const IMAGE_SETTINGS_TTL = 3600; // 1 hour

export async function getImageSettings(options?: { forceRefresh?: boolean }): Promise<ImageSettings> {
  if (!options?.forceRefresh) {
    const cached = await getCachedJson<ImageSettings>(REDIS_IMAGE_SETTINGS_KEY);
    if (cached) return cached;
  }

  const row = await db.appSetting.findUnique({
    where: { settingKey: IMAGE_CATALOG_SETTING_KEY },
    select: { value: true },
  });
  const value = typeof row?.value === "string" ? row.value.trim() : "";
  const settings: ImageSettings = { catalogModelId: value || null };
  await setCachedJson(REDIS_IMAGE_SETTINGS_KEY, settings, IMAGE_SETTINGS_TTL);
  return settings;
}

/** Saves the image catalog model after checking it exists, is active, and is an image model. */
export async function updateImageSettings(
  catalogModelId: string,
  userId?: bigint | null
): Promise<ImageSettings> {
  const publicId = catalogModelId.trim();
  const model = await db.catalogModel.findUnique({
    where: { publicId },
    select: { status: true, category: true },
  });
  if (!model) throw ApiError.badRequest(`Catalog model '${publicId}' tidak ditemukan`);
  if (model.category !== IMAGE_CATALOG_CATEGORY) {
    throw ApiError.badRequest(`Catalog model '${publicId}' bukan kategori '${IMAGE_CATALOG_CATEGORY}'`);
  }
  if (model.status !== "active") throw ApiError.badRequest(`Catalog model '${publicId}' belum aktif`);

  await db.appSetting.upsert({
    where: { settingKey: IMAGE_CATALOG_SETTING_KEY },
    create: { settingKey: IMAGE_CATALOG_SETTING_KEY, value: publicId, updatedBy: userId ?? null },
    update: { value: publicId, updatedBy: userId ?? null },
  });

  const updated: ImageSettings = { catalogModelId: publicId };
  await invalidateCacheKey(REDIS_IMAGE_SETTINGS_KEY);
  await setCachedJson(REDIS_IMAGE_SETTINGS_KEY, updated, IMAGE_SETTINGS_TTL);
  return updated;
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
