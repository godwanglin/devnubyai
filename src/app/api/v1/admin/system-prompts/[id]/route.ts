import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { deleteSystemPrompt, updateSystemPrompt } from "@/lib/chat/system-prompts";
import { systemPromptUpdateSchema } from "@/lib/chat/system-prompts-shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const adminUser = await requireAdmin();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const parsed = systemPromptUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid system prompt payload", parsed.error.format());
    }

    const prompt = await updateSystemPrompt(id, parsed.data, adminUser.id);
    return jsonSuccess({ prompt }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const adminUser = await requireAdmin();
    const { id } = await context.params;
    await deleteSystemPrompt(id, adminUser.id);
    return jsonSuccess({ success: true }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
