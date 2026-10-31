import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import {
  deleteAdminPlan,
  updateAdminPlan,
  updatePlanSchema,
} from "@/lib/plans/admin-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const adminUser = await requireAdmin();
    const { id: rawId } = await context.params;

    let id: bigint;
    try {
      id = BigInt(rawId);
    } catch {
      throw ApiError.badRequest("Invalid plan ID");
    }

    const body = await request.json().catch(() => ({}));
    const parsed = updatePlanSchema.parse(body);

    const plan = await updateAdminPlan(id, parsed, adminUser.id);
    return jsonSuccess({ plan }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const adminUser = await requireAdmin();
    const { id: rawId } = await context.params;

    let id: bigint;
    try {
      id = BigInt(rawId);
    } catch {
      throw ApiError.badRequest("Invalid plan ID");
    }

    await deleteAdminPlan(id, adminUser.id);
    return jsonSuccess({ success: true }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
