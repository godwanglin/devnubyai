import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { isOAuthProviderId } from "@/lib/oauth/providers";
import { refreshAllConnectionsQuota } from "@/lib/gateways/provider-service";

interface RouteContext {
  params: Promise<{ providerId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const { providerId } = await context.params;

    if (!isOAuthProviderId(providerId)) {
      throw ApiError.notFound(`Unknown provider: ${providerId}`);
    }

    const quotas = await refreshAllConnectionsQuota(providerId);
    return jsonSuccess({ quotas }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
