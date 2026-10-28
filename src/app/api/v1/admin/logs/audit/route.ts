import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import {
  auditLogsQuerySchema,
  listAdminAuditLogs,
} from "@/lib/logs/admin-service";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const { searchParams } = new URL(request.url);

    const parsedQuery = auditLogsQuerySchema.parse({
      entityType: searchParams.get("entityType") ?? undefined,
      action: searchParams.get("action") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    });

    const result = await listAdminAuditLogs(parsedQuery);
    return jsonSuccess(result, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
