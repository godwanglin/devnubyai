import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { chatSettingsSchema, getChatSettings, updateChatSettings } from "@/lib/chat/settings";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const settings = await getChatSettings({ forceRefresh: true });
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

    const parsed = chatSettingsSchema.partial().safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid settings payload", parsed.error.format());
    }

    const settings = await updateChatSettings(parsed.data, adminUser.id);
    return jsonSuccess({ settings }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
