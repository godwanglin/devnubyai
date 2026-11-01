import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import {
  getChatSession,
  updateChatSession,
  deleteChatSession,
} from "@/lib/chat/service";

const updateChatSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  isPinned: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  model: z.string().trim().max(128).optional(),
  projectId: z.string().trim().nullable().optional(),
  isLocked: z.boolean().optional(),
});

type RouteContext = { params: Promise<{ chatId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const user = await requireUser();
    const { chatId } = await context.params;
   
    const session = await getChatSession(user.id, chatId);

    return jsonSuccess(
      {
        id: session.publicId,
        title: session.title,
        isPinned: session.isPinned,
        isArchived: session.isArchived,
        shareToken: session.shareToken,
        catalogModelId: session.catalogModelPublicId,
        projectId: session.projectId,
        isLocked: session.isLocked,
        lastMessageAt: session.lastMessageAt.toISOString(),
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const { chatId } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw ApiError.badRequest("Invalid JSON body");
    }

    const parsed = updateChatSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid chat update payload", parsed.error.format());
    }

    const updated = await updateChatSession(user.id, chatId, {
      title: parsed.data.title,
      isPinned: parsed.data.isPinned,
      isArchived: parsed.data.isArchived,
      modelPublicId: parsed.data.model,
      projectId: parsed.data.projectId,
      isLocked: parsed.data.isLocked,
    });

    return jsonSuccess(updated, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const { chatId } = await context.params;
    await deleteChatSession(user.id, chatId);

    return jsonSuccess({ deleted: true }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
