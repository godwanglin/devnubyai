import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { isOAuthProviderId } from "@/lib/oauth/providers";
import { initOAuthFlow } from "@/lib/oauth/flow-service";

interface RouteContext {
  params: Promise<{ providerId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const admin = await requireAdmin();
    const { providerId } = await context.params;

    if (!isOAuthProviderId(providerId)) {
      throw ApiError.notFound(`Unknown provider: ${providerId}`);
    }

    const initData = await initOAuthFlow(providerId, admin.id);
    return jsonSuccess({ session: initData }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
