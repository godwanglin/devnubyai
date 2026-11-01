import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getDokuConfig } from "@/lib/doku/settings";
import { createDokuCheckout, DokuApiError } from "@/lib/doku/client";
import { dokuCheckoutRequestSchema, DEFAULT_CUSTOMER_PHONE } from "@/lib/doku/schemas";
import type { Prisma } from "@/generated/client";

export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();

    const { config } = await getDokuConfig();
    if (!config.isEnabled) {
      throw ApiError.badRequest("DOKU payment gateway is currently disabled");
    }

    if (!config.clientId || !config.secretKey) {
      throw ApiError.badRequest("DOKU payment gateway credentials are not configured");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw ApiError.badRequest("Invalid JSON body");
    }

    const parsed = dokuCheckoutRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid checkout request", parsed.error.format());
    }

    // Auto-fill customer info if not explicitly provided
    const checkoutRequest = {
      ...parsed.data,
      customer: {
        id: parsed.data.customer.id || user.id.toString(),
        name: parsed.data.customer.name || user.name || "Customer",
        email: parsed.data.customer.email || user.email,
        phone: parsed.data.customer.phone?.trim() || DEFAULT_CUSTOMER_PHONE,
      },
    };

    try {
      const result = await createDokuCheckout(config, checkoutRequest);

      // Match payment method if configured
      const methodCode = parsed.data.paymentMethodTypes?.[0]?.toLowerCase() || "qris";
      const method = await db.paymentMethod.findFirst({
        where: { code: methodCode },
        select: { id: true, name: true },
      });

      // Persist transaction record
      await db.paymentTransaction.create({
        data: {
          invoiceNumber: result.invoiceNumber,
          userId: user.id,
          paymentMethodId: method?.id || null,
          paymentMethodCode: methodCode,
          paymentMethodName: method?.name || (methodCode === "qris" ? "QRIS" : "Checkout"),
          amount: result.amount,
          fee: 0,
          totalAmount: result.amount,
          currency: "IDR",
          status: "PENDING",
          checkoutUrl: result.paymentUrl,
          customerName: checkoutRequest.customer.name,
          customerEmail: checkoutRequest.customer.email,
          customerPhone: checkoutRequest.customer.phone || null,
          metadata: (parsed.data.metadata as Prisma.InputJsonValue) || undefined,
          dokuResponse: result.rawResponse ? (result.rawResponse as Prisma.InputJsonValue) : undefined,
          expiredAt: result.expiredDate ? new Date(result.expiredDate) : undefined,
        },
      });

      return jsonSuccess(result, { requestId });
    } catch (err) {
      if (err instanceof DokuApiError) {
        throw new ApiError(err.status, "BAD_REQUEST", err.message, err.details);
      }
      throw err;
    }
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
