import { getSession } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getUserQuotaWindows } from "@/lib/chat/quota";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const session = await getSession();
    if (!session) {
      throw ApiError.unauthorized("Authentication required");
    }

    const { user } = session;
    const windows = await getUserQuotaWindows(user.id, user.plan);
    const msUntilReset = new Date(windows.monthly.resetAt).getTime() - Date.now();
    const resetInDays = Math.max(1, Math.ceil(msUntilReset / (1000 * 60 * 60 * 24)));

    return jsonSuccess(
      {
        quota: {
          usedPercent: windows.monthly.usedPercent,
          usedTokens: windows.monthly.usedTokens,
          limitTokens: windows.monthly.limitTokens,
          resetInDays,
          resetAt: windows.monthly.resetAt,
          requestCount: windows.monthly.requestCount,
          windows,
        },
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
