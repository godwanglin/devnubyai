import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { togglePaymentMethod } from "@/lib/payments/methods";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;

    const updated = await togglePaymentMethod(id, admin.id);
    return jsonSuccess({ method: updated }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
