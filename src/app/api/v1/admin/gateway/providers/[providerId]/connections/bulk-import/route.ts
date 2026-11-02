import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { bulkImportOpenAiConnections } from "@/lib/gateways/bulk-import-service";

interface RouteContext {
  params: Promise<{ providerId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const admin = await requireAdmin();
    const { providerId } = await context.params;

    if (providerId !== "openai") {
      throw ApiError.badRequest("Bulk import hanya didukung untuk provider OpenAI (ChatGPT)");
    }

    const body = (await request.json().catch(() => null)) as unknown;
    if (!body) {
      throw ApiError.badRequest("Body JSON tidak valid");
    }

    const result = await bulkImportOpenAiConnections(body, admin.id);
    return jsonSuccess({ import: result }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
