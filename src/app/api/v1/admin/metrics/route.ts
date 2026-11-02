import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getAdminMetrics } from "@/lib/metrics/metrics-service";
import type { MetricsTimeRange } from "@/lib/metrics/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();

    const url = new URL(request.url);
    const rangeParam = url.searchParams.get("range") || "7d";
    const validRanges: MetricsTimeRange[] = ["24h", "7d", "30d", "all"];
    const range: MetricsTimeRange = validRanges.includes(rangeParam as MetricsTimeRange)
      ? (rangeParam as MetricsTimeRange)
      : "7d";

    const data = await getAdminMetrics(range);
    return jsonSuccess(data, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
