import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { listOAuthProvidersSummary } from "@/lib/gateways/provider-service";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const providers = await listOAuthProvidersSummary();
    return jsonSuccess({ providers }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
