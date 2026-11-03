import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getTripayPublicSettings } from "@/lib/tripay/config";
import { getTripayChannels } from "@/lib/tripay/channels";
import { TripayApiError } from "@/lib/tripay/client";

/** GET /api/v1/admin/settings/payment/tripay — masked settings and the merchant's channels */
export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    await requireAdmin();
    const settings = getTripayPublicSettings();
    let channels: Awaited<ReturnType<typeof getTripayChannels>> = [];
    if (settings.isConfigured) {
      try {
        channels = await getTripayChannels();
      } catch (err) {
        console.warn("[Tripay] Failed to fetch channels:", err);
      }
    }
    return jsonSuccess({ settings, channels }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

/** POST { action: "test_connection" | "refresh_channels" } */
export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    await requireAdmin();

    const body = (await request.json().catch(() => null)) as { action?: string } | null;
    const action = body?.action || "test_connection";

    if (action !== "test_connection" && action !== "refresh_channels") {
      throw ApiError.badRequest("Unsupported action");
    }

    try {
      const channels = await getTripayChannels({ forceRefresh: true });
      return jsonSuccess(
        {
          success: true,
          message: "Koneksi ke Tripay API berhasil! Daftar channel pembayaran telah diperbarui.",
          details: {
            channelCount: channels.length,
            activeCount: channels.filter((c) => c.active).length,
            channels,
          },
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
