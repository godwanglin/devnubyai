import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { listPaymentMethods, createPaymentMethod } from "@/lib/payments/methods";
import { paymentMethodCreateSchema } from "@/lib/payments/schemas";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    await requireAdmin();
    const methods = await listPaymentMethods();
    return jsonSuccess({ methods }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const admin = await requireAdmin();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw ApiError.badRequest("Invalid JSON body");
    }

    const parsed = paymentMethodCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Data metode pembayaran tidak valid", parsed.error.format());
    }

    const created = await createPaymentMethod(parsed.data, admin.id);
    return jsonSuccess({ method: created }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
