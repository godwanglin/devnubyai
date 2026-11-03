import { requireAdmin } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { recordAdminAudit } from "@/lib/admin/audit";
import { invalidatePaymentMethodsCache } from "@/lib/redis/cache-keys";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { z } from "zod";

const failoverSchema = z.object({
  primaryProvider: z.enum(["tripay", "doku"]),
});

/**
 * POST /api/v1/admin/payment-methods/failover
 * One-click gateway switch: activates all payment methods of `primaryProvider`
 * and disables the other provider, or keeps both active based on user choice.
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireAdmin();

    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = failoverSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid payload: primaryProvider must be 'tripay' or 'doku'");
    }

    const { primaryProvider } = parsed.data;
    const secondaryProvider = primaryProvider === "tripay" ? "doku" : "tripay";

    // Activate all methods belonging to primaryProvider
    const enabled = await db.paymentMethod.updateMany({
      where: { provider: primaryProvider },
      data: { isActive: true },
    });

    // Deactivate methods belonging to secondaryProvider so user checkout routes cleanly
    const disabled = await db.paymentMethod.updateMany({
      where: { provider: secondaryProvider },
      data: { isActive: false },
    });

    await recordAdminAudit({
      actorUserId: user.id,
      action: "payment_method.failover",
      entityType: "payment_method",
      entityId: primaryProvider,
      afterState: {
        primaryProvider,
        enabledCount: enabled.count,
        disabledCount: disabled.count,
      },
    });

    await invalidatePaymentMethodsCache();

    return jsonSuccess(
      {
        primaryProvider,
        enabledCount: enabled.count,
        disabledCount: disabled.count,
        message: `Berhasil mengalihkan pembayaran utama ke ${primaryProvider.toUpperCase()}. ${enabled.count} metode diaktifkan, ${disabled.count} metode ${secondaryProvider.toUpperCase()} dinonaktifkan.`,
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
