import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { updateTransactionStatusManually } from "@/lib/payments/transactions";
import { paymentTransactionManualStatusSchema } from "@/lib/payments/schemas";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw ApiError.badRequest("Invalid JSON body");
    }

    const parsed = paymentTransactionManualStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Data perubahan status tidak valid", parsed.error.format());
    }

    const updated = await updateTransactionStatusManually(id, parsed.data, {
      id: admin.id,
      name: admin.name || "Admin",
    });

    return jsonSuccess({ transaction: updated }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
