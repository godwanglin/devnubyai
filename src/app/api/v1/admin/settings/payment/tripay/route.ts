import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getTripayConfig, getTripayPublicSettings } from "@/lib/tripay/config";
import { listTripayChannels, TripayApiError } from "@/lib/tripay/client";
import { TRIPAY_QRIS_CHANNELS } from "@/lib/tripay/types";

/** GET /api/v1/admin/settings/payment/tripay — masked Tripay settings (from .env) */
export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    await requireAdmin();
    return jsonSuccess({ settings: getTripayPublicSettings() }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

/** POST { action: "test_connection" } — checks the credentials and lists active QRIS channels */
export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    await requireAdmin();

    const body = (await request.json().catch(() => null)) as { action?: string } | null;
    if (body?.action !== "test_connection") {
      throw ApiError.badRequest("Unsupported action");
    }

    try {
      const channels = await listTripayChannels(getTripayConfig());
      const qris = channels
        .filter((c) => (TRIPAY_QRIS_CHANNELS as readonly string[]).includes(c.code))
        .map((c) => ({ code: c.code, name: c.name, active: c.active }));
      return jsonSuccess(
        {
          success: true,
          message: "Koneksi ke Tripay API berhasil diverifikasi!",
          details: { qrisChannels: qris },
        },
        { requestId }
      );
    } catch (err) {
      if (err instanceof TripayApiError) {
        throw new ApiError(err.status, "BAD_REQUEST", err.message);
      }
      throw err;
    }
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
