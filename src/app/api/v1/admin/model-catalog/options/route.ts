import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import {
  listModelProviders,
  listUpstreamOptions,
} from "@/lib/catalog-models/admin-service";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();

    const [providers, upstreamModels] = await Promise.all([
      listModelProviders(),
      listUpstreamOptions(),
    ]);

    return jsonSuccess({ providers, upstreamModels }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
