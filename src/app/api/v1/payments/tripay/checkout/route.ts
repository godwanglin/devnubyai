import crypto from "node:crypto";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getPublicOrigin } from "@/lib/api/origin";
import { resolvePlanCheckout } from "@/lib/payments/plan-checkout";
import { getTripayConfig } from "@/lib/tripay/config";
import { createTripayQrisTransaction, TripayApiError } from "@/lib/tripay/client";
import { tripayCheckoutRequestSchema } from "@/lib/tripay/schemas";
import type { Prisma } from "@/generated/client";

/**
 * POST /api/v1/payments/tripay/checkout
 * Creates a Tripay QRIS transaction for a plan purchase and returns the QR payload.
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
      select: { id: true, code: true, name: true, dokuCode: true, minAmount: true, maxAmount: true },
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
    const customer = {
      name: user.name || "Customer",
      email: user.email,
    };

    try {
      const result = await createTripayQrisTransaction(config, {
        channel: method.dokuCode,
        merchantRef: invoiceNumber,
        amount: planCheckout.amount,
        customer,
        items: [{ name: planCheckout.itemName, price: planCheckout.amount, quantity: 1 }],
        returnUrl: `${appOrigin}/plans?payment=success&invoice=${encodeURIComponent(invoiceNumber)}`,
      });

      if (!result.qr_string) {
        throw new TripayApiError("Tripay did not return a QR code", 502, result);
      }

      const fee = Math.max(0, Number(result.fee_customer) || 0);
      const totalAmount = planCheckout.amount + fee;
      const expiredAt = result.expired_time
        ? new Date(result.expired_time * 1000)
        : new Date(Date.now() + 60 * 60 * 1000);

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
          qrContent: result.qr_string,
          customerName: customer.name,
          customerEmail: customer.email,
          metadata: planCheckout.metadata as Prisma.InputJsonValue,
          gatewayResponse: result as Prisma.InputJsonValue,
          expiredAt,
        },
      });

      return jsonSuccess(
        {
          invoiceNumber,
          qrString: result.qr_string,
          amount: planCheckout.amount,
          fee,
          totalAmount,
          expiredAt: expiredAt.toISOString(),
        },
        { requestId }
      );
    } catch (err) {
      if (err instanceof TripayApiError) {
        console.error("[Tripay] create transaction failed:", err.message);
        throw new ApiError(err.status, "BAD_REQUEST", err.message);
      }
      throw err;
    }
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
