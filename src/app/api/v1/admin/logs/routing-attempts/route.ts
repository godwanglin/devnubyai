import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import {
  listRoutingAttempts,
  routingAttemptsQuerySchema,
} from "@/lib/logs/admin-service";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const { searchParams } = new URL(request.url);

    const parsedQuery = routingAttemptsQuerySchema.parse({
      outcome: searchParams.get("outcome") ?? undefined,
      gatewayId: searchParams.get("gatewayId") ?? undefined,
      date: searchParams.get("date") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    });

    const result = await listRoutingAttempts(parsedQuery);
    return jsonSuccess(result, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
