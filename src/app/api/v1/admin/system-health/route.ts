import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getSystemHealthReport } from "@/lib/system-health/health-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const report = await getSystemHealthReport();
    return jsonSuccess(report, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
