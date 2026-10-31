import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { duplicateChatSession } from "@/lib/chat/service";

const duplicateChatSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

type RouteContext = { params: Promise<{ chatId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const { chatId } = await context.params;

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const parsed = duplicateChatSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid duplicate chat payload", parsed.error.format());
    }

    const duplicated = await duplicateChatSession(
      user.id,
      user.publicId,
      chatId,
      { title: parsed.data.title }
    );

    return jsonSuccess(duplicated, { status: 201, requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
