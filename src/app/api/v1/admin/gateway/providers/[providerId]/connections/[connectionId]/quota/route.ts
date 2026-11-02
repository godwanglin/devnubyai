import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { isOAuthProviderId } from "@/lib/oauth/providers";
import { refreshSingleConnectionQuota } from "@/lib/gateways/provider-service";

interface RouteContext {
  params: Promise<{ providerId: string; connectionId: string }>;
}

function parseConnectionId(raw: string): bigint {
  try {
    const id = BigInt(raw);
    if (id <= 0n) throw new Error();
    return id;
  } catch {
    throw ApiError.badRequest("Invalid connection ID");
  }
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const { providerId, connectionId: rawConnId } = await context.params;

    if (!isOAuthProviderId(providerId)) {
      throw ApiError.notFound(`Unknown provider: ${providerId}`);
    }

    const connectionId = parseConnectionId(rawConnId);
    const quota = await refreshSingleConnectionQuota(connectionId, providerId);

    return jsonSuccess({ quota }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
