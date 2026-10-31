import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { listPaymentTransactions, getTransactionStats } from "@/lib/payments/transactions";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const status = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;
    const fromDate = searchParams.get("fromDate") || undefined;
    const toDate = searchParams.get("toDate") || undefined;

    const [data, stats] = await Promise.all([
      listPaymentTransactions({ page, limit, status, search, fromDate, toDate }),
      getTransactionStats(),
    ]);

    return jsonSuccess(
      {
        transactions: data.transactions,
        pagination: data.pagination,
        stats,
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
