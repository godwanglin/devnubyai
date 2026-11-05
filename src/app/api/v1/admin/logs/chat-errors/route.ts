import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { chatErrorQuerySchema, listChatErrorTraces } from "@/lib/logs/admin-service";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const { searchParams } = new URL(request.url);
    const query = chatErrorQuerySchema.parse({
      search: searchParams.get("search") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    });

    return jsonSuccess(await listChatErrorTraces(query), { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
