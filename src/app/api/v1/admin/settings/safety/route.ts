import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import {
  getSafetySettings,
  listSafetyClassifierModels,
  updateSafetySettings,
} from "@/lib/safety/settings";
import { z } from "zod";

const patchSchema = z.object({
  /** Catalog model public id, or null / "" to turn the safety gate off */
  classifierModelId: z.string().trim().nullable(),
});

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const [settings, availableModels] = await Promise.all([
      getSafetySettings({ forceRefresh: true }),
      listSafetyClassifierModels(),
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
      throw ApiError.badRequest("Invalid payload: 'classifierModelId' must be a string or null", parsed.error.format());
    }

    const settings = await updateSafetySettings(parsed.data.classifierModelId, adminUser.id);
    return jsonSuccess({ settings }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
