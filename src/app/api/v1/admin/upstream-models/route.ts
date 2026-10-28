import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import {
  listSanitizedUpstreamModels,
  listUpstreamModelsQuerySchema,
} from "@/lib/upstream-models/admin-service";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const parsedQuery = listUpstreamModelsQuerySchema.parse({
      gatewayId: searchParams.get("gatewayId") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      available: searchParams.get("available") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    });

    const result = await listSanitizedUpstreamModels(parsedQuery);
    return jsonSuccess(result, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
