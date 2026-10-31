import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { enableChatShare, revokeChatShare } from "@/lib/chat/share";

type RouteContext = { params: Promise<{ chatId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const { chatId } = await context.params;
    const result = await enableChatShare(user.id, chatId);
    return jsonSuccess(result, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const { chatId } = await context.params;
    await revokeChatShare(user.id, chatId);
    return jsonSuccess({ revoked: true }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
