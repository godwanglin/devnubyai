import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import {
  getAdminUserDetail,
  updateAdminUser,
  updateAdminUserSchema,
  deleteAdminUser,
} from "@/lib/users/admin-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const { id } = await context.params;

    const user = await getAdminUserDetail(id);
    return jsonSuccess({ user }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const admin = await requireAdmin();
    const { id } = await context.params;

    const body = await request.json().catch(() => ({}));
    const parsed = updateAdminUserSchema.parse(body);

    const user = await updateAdminUser(id, parsed, admin.id);
    return jsonSuccess({ user }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const admin = await requireAdmin();
    const { id } = await context.params;

    await deleteAdminUser(id, admin.id);
    return jsonSuccess({ success: true }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
