import crypto from "node:crypto";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getPublicOrigin } from "@/lib/api/origin";
import { resolvePlanCheckout } from "@/lib/payments/plan-checkout";
import { getTripayConfig } from "@/lib/tripay/config";
import { createTripayTransaction, TripayApiError } from "@/lib/tripay/client";
import { tripayPaymentKind, type TripayPaymentResult } from "@/lib/tripay/payment-kind";
import { isTripayPhoneRequiredError, tripayCheckoutRequestSchema } from "@/lib/tripay/schemas";
import { resolveDirectWalletUrl } from "@/lib/tripay/scraper";
import { normalizeIndonesianPhone, PHONE_REQUIRED_CODE } from "@/lib/payments/phone";
import type { Prisma } from "@/generated/client";

/**
 * POST /api/v1/payments/tripay/checkout
 * Creates a Tripay transaction for a plan purchase on any enabled channel and
 * returns what the UI needs: a QR payload, a VA/pay code, or Tripay's checkout URL.
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();

    const config = getTripayConfig();
    if (!config.isConfigured) {
      throw ApiError.badRequest("Tripay payment gateway is not configured");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw ApiError.badRequest("Invalid JSON body");
    }

    const parsed = tripayCheckoutRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid checkout request", parsed.error.format());
    }

    const method = await db.paymentMethod.findFirst({
      where: { publicId: parsed.data.methodId, provider: "tripay", isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        dokuCode: true,
        category: true,
        flowType: true,
        minAmount: true,
        maxAmount: true,
      },
    });
    if (!method?.dokuCode) {
      throw ApiError.badRequest("Metode pembayaran tidak tersedia");
    }

    const planCheckout = await resolvePlanCheckout(parsed.data.metadata, parsed.data.amount);
    if (
      planCheckout.amount < method.minAmount ||
      (method.maxAmount !== null && planCheckout.amount > method.maxAmount)
    ) {
      throw ApiError.badRequest("Nominal di luar batas metode pembayaran ini");
    }

    // Invoice numbers are minted here, never taken from the client
    const invoiceNumber = `INV-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const appOrigin = new URL(getPublicOrigin(request)).origin;

    // Load user's saved phone or accept and save the one submitted with the request
    const userRecord = await db.user.findUnique({
      where: { id: user.id },
      select: { phone: true },
    });
    let resolvedPhone = userRecord?.phone || null;

    if (parsed.data.customerPhone) {
      const normalized = normalizeIndonesianPhone(parsed.data.customerPhone);
      if (!normalized) {
        throw new ApiError(
          400,
          "BAD_REQUEST",
          "Format nomor HP tidak valid. Gunakan format Indonesia (misal: 08123456789 atau 628123456789)."
        );
      }
      resolvedPhone = normalized;
      await db.user.update({
        where: { id: user.id },
        data: { phone: normalized },
      });
    }

    const kind = tripayPaymentKind(method);

    // E-wallet channels in Tripay require a phone number up front
    if (!resolvedPhone && kind === "redirect") {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "Metode pembayaran ini memerlukan nomor WhatsApp/HP aktif untuk memproses pembayaran.",
        { code: PHONE_REQUIRED_CODE }
      );
    }

    const customer = {
      name: user.name || "Customer",
      email: user.email,
      ...(resolvedPhone ? { phone: resolvedPhone } : {}),
    };

    try {
      const result = await createTripayTransaction(config, {
        channel: method.dokuCode,
        merchantRef: invoiceNumber,
        amount: planCheckout.amount,
        customer,
        items: [{ name: planCheckout.itemName, price: planCheckout.amount, quantity: 1 }],
        returnUrl: `${appOrigin}/plans?payment=success&invoice=${encodeURIComponent(invoiceNumber)}`,
      });

      if (kind === "qris" && !result.qr_string) {
        throw new TripayApiError("Tripay did not return a QR code", 502, result);
      }
      if (kind === "pay_code" && !result.pay_code) {
        throw new TripayApiError("Tripay did not return a payment code", 502, result);
      }
      if (kind === "redirect" && !result.checkout_url) {
        throw new TripayApiError("Tripay did not return a checkout URL", 502, result);
      }

      const fee = Math.max(0, Number(result.fee_customer) || 0);
      const totalAmount = planCheckout.amount + fee;
      const expiredAt = result.expired_time
        ? new Date(result.expired_time * 1000)
        : new Date(Date.now() + 60 * 60 * 1000);

      // If it's a redirect channel (e.g. DANA), scrape the direct wallet deep-link
      // from the Tripay checkout page so user bypasses the Tripay intermediary page
      let effectiveCheckoutUrl = result.checkout_url || null;
      if (kind === "redirect" && result.checkout_url) {
        const directUrl = await resolveDirectWalletUrl(result.checkout_url);
        if (directUrl) {
          effectiveCheckoutUrl = directUrl;
        }
      }

      await db.paymentTransaction.create({
        data: {
          invoiceNumber,
          userId: user.id,
          paymentMethodId: method.id,
          paymentMethodCode: method.code,
          paymentMethodName: method.name,
          provider: "tripay",
          providerReference: result.reference,
          amount: planCheckout.amount,
          fee,
          totalAmount,
          currency: "IDR",
          status: "PENDING",
          qrContent: result.qr_string || null,
          paymentCode: result.pay_code || null,
          checkoutUrl: effectiveCheckoutUrl,
          customerName: customer.name,
          customerEmail: customer.email,
          customerPhone: resolvedPhone,
          metadata: planCheckout.metadata as Prisma.InputJsonValue,
          gatewayResponse: result as Prisma.InputJsonValue,
          expiredAt,
        },
      });

      const payment: TripayPaymentResult = {
        invoiceNumber,
        kind,
        paymentName: method.name,
        qrString: result.qr_string || null,
        payCode: result.pay_code || null,
        checkoutUrl: effectiveCheckoutUrl,
        instructions: Array.isArray(result.instructions) ? result.instructions : [],
        amount: planCheckout.amount,
        fee,
        totalAmount,
        expiredAt: expiredAt.toISOString(),
      };
      return jsonSuccess(payment, { requestId });
    } catch (err) {
      if (err instanceof TripayApiError) {
        console.error("[Tripay] create transaction failed:", err.message);
        if (isTripayPhoneRequiredError(err.message)) {
          throw new ApiError(
            400,
            "BAD_REQUEST",
            "Metode pembayaran ini memerlukan nomor WhatsApp/HP aktif untuk memproses pembayaran.",
            { code: PHONE_REQUIRED_CODE }
          );
        }
        throw new ApiError(err.status, "BAD_REQUEST", err.message);
      }
      throw err;
    }
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
