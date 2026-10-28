import { destroySession } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    await destroySession();
    return jsonSuccess({ ok: true }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
