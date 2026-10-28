import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import {
  getSanitizedUpstreamModel,
  toggleUpstreamModelAvailability,
  updateUpstreamModelSchema,
} from "@/lib/upstream-models/admin-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext
) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const { id: rawId } = await context.params;

    let id: bigint;
    try {
      id = BigInt(rawId);
    } catch {
      throw ApiError.badRequest("Invalid model ID");
    }

    const model = await getSanitizedUpstreamModel(id);
    return jsonSuccess({ model }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext
) {
  const requestId = getRequestId(request);

  try {
    const adminUser = await requireAdmin();
    const { id: rawId } = await context.params;

    let id: bigint;
    try {
      id = BigInt(rawId);
    } catch {
      throw ApiError.badRequest("Invalid model ID");
    }

    const body = await request.json().catch(() => ({}));
    const parsed = updateUpstreamModelSchema.parse(body);

    const updated = await toggleUpstreamModelAvailability(
      id,
      parsed.isAvailable,
      adminUser.id
    );

    return jsonSuccess({ model: updated }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
