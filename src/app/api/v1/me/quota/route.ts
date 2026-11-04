import { getSession } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getUserQuotaWindows, toQuotaPayload } from "@/lib/chat/quota";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const session = await getSession();
    if (!session) {
      throw ApiError.unauthorized("Authentication required");
    }

    const { user } = session;
    const windows = await getUserQuotaWindows(user.id, user.plan);

    return jsonSuccess({ quota: toQuotaPayload(windows) }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
