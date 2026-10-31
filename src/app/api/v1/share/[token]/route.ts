import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getPublicSharedChat } from "@/lib/chat/share";

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const { token } = await context.params;
    const shared = await getPublicSharedChat(token);
    return jsonSuccess(shared, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
