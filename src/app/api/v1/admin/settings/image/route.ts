import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import {
  getImageSettings,
  updateImageSettings,
  listImageCatalogModels,
} from "@/lib/images/settings";
import { z } from "zod";

const patchSchema = z.object({
  catalogModelId: z.string().trim().min(1),
});

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const [settings, availableModels] = await Promise.all([
      getImageSettings({ forceRefresh: true }),
      listImageCatalogModels(),
    ]);

    return jsonSuccess({ settings, availableModels }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);

  try {
    const adminUser = await requireAdmin();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw ApiError.badRequest("Invalid JSON body");
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid payload: 'catalogModelId' is required", parsed.error.format());
    }

    const settings = await updateImageSettings(parsed.data.catalogModelId, adminUser.id);
    return jsonSuccess({ settings }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
