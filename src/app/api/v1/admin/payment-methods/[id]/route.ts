import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import {
  getPaymentMethodByPublicId,
  updatePaymentMethod,
  deletePaymentMethod,
} from "@/lib/payments/methods";
import { paymentMethodUpdateSchema } from "@/lib/payments/schemas";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    await requireAdmin();
    const { id } = await context.params;

    const method = await getPaymentMethodByPublicId(id);
    if (!method) {
      throw ApiError.notFound("Metode pembayaran tidak ditemukan");
    }

    return jsonSuccess({ method }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

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

    const parsed = paymentMethodUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Data update tidak valid", parsed.error.format());
    }

    const updated = await updatePaymentMethod(id, parsed.data, admin.id);
    return jsonSuccess({ method: updated }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;

    await deletePaymentMethod(id, admin.id);
    return jsonSuccess({ deleted: true }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
