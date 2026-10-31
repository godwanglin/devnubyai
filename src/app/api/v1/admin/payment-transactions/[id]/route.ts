import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getPaymentTransactionByPublicId } from "@/lib/payments/transactions";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    await requireAdmin();
    const { id } = await context.params;

    const transaction = await getPaymentTransactionByPublicId(id);
    if (!transaction) {
      throw ApiError.notFound("Transaksi tidak ditemukan");
    }

    return jsonSuccess({ transaction }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
