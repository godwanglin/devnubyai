import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { triggerOvoPayment } from "@/lib/tripay/scraper";
import { normalizeIndonesianPhone } from "@/lib/payments/phone";

const ovoRepushSchema = z.object({
  invoiceNumber: z.string().min(1, "Invoice number is required"),
  phone: z.string().min(1, "Phone number is required"),
});

/**
 * POST /api/v1/payments/tripay/ovo-repush
 * Allows users to re-trigger / push payment notification to OVO app
 * with their chosen phone number (which can be their default or a different OVO number).
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw ApiError.badRequest("Invalid JSON body");
    }

    const parsed = ovoRepushSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Data tidak valid", parsed.error.format());
    }

    const normalizedPhone = normalizeIndonesianPhone(parsed.data.phone);
    if (!normalizedPhone) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "Format nomor OVO tidak valid. Gunakan format Indonesia (misal: 08123456789 atau 628123456789)."
      );
    }

    // Verify invoice belongs to this user and is still pending
    const tx = await db.paymentTransaction.findFirst({
      where: {
        invoiceNumber: parsed.data.invoiceNumber,
        userId: user.id,
        status: "PENDING",
      },
      select: {
        id: true,
        invoiceNumber: true,
        checkoutUrl: true,
        providerReference: true,
        gatewayResponse: true,
        expiredAt: true,
      },
    });

    if (!tx) {
      throw ApiError.notFound("Tagihan tidak ditemukan atau sudah tidak aktif");
    }

    if (tx.expiredAt && tx.expiredAt.getTime() <= Date.now()) {
      throw ApiError.badRequest("Waktu pembayaran telah kedaluwarsa");
    }

    // Extract checkoutUrl from gatewayResponse if tx.checkoutUrl was altered
    const gateway = tx.gatewayResponse as { checkout_url?: string } | null;
    const checkoutUrl = gateway?.checkout_url || tx.checkoutUrl;

    if (!checkoutUrl || !tx.providerReference) {
      throw ApiError.badRequest("Informasi pembayaran Tripay OVO tidak lengkap");
    }

    // Trigger OVO push notification on Tripay
    const triggerRes = await triggerOvoPayment(checkoutUrl, tx.providerReference, normalizedPhone);
    if (!triggerRes.success) {
      throw new ApiError(502, "MODEL_UNAVAILABLE", triggerRes.message || "Gagal mengirim notifikasi OVO ke Tripay");
    }

    // Update customerPhone on transaction record
    await db.paymentTransaction.update({
      where: { id: tx.id },
      data: { customerPhone: normalizedPhone },
    });

    return jsonSuccess(
      {
        success: true,
        phone: normalizedPhone,
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
