import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { listPaymentMethods } from "@/lib/payments/methods";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const methods = await listPaymentMethods({ onlyActive: true });
    return jsonSuccess({ methods }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
