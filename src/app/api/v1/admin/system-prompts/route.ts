import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { createSystemPrompt, listSystemPrompts } from "@/lib/chat/system-prompts";
import { systemPromptInputSchema } from "@/lib/chat/system-prompts-shared";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const prompts = await listSystemPrompts();
    return jsonSuccess({ prompts }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const adminUser = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const parsed = systemPromptInputSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid system prompt payload", parsed.error.format());
    }

    const prompt = await createSystemPrompt(parsed.data, adminUser.id);
    return jsonSuccess({ prompt }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
