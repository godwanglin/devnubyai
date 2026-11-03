import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { partialUpdate } from "@/lib/api/zod-partial";
import {
  getLegalSettings,
  updateLegalSettings,
  legalSettingsSchema,
} from "@/lib/legal/settings";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const settings = await getLegalSettings({ forceRefresh: true });
    return jsonSuccess({ settings }, { requestId });
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

    const parsed = partialUpdate(legalSettingsSchema).safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid settings payload", parsed.error.format());
    }

    const settings = await updateLegalSettings(parsed.data, adminUser.id);
    return jsonSuccess({ settings }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
