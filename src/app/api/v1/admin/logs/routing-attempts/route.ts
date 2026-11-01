import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import {
  listRoutingAttempts,
  routingAttemptsQuerySchema,
} from "@/lib/logs/admin-service";
import { deleteLogFile } from "@/lib/logger/file-logger";

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

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    if (!date) {
      throw ApiError.badRequest("Date parameter (YYYY-MM-DD) is required to delete log file");
    }

    const deleted = await deleteLogFile(date);
    return jsonSuccess({ deleted, date }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
