import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getDokuConfig } from "@/lib/doku/settings";
import { createDokuDirectVa, DokuApiError } from "@/lib/doku/client";
import { dokuDirectVaRequestSchema, DEFAULT_CUSTOMER_PHONE } from "@/lib/doku/schemas";
import { resolvePlanCheckout } from "@/lib/payments/plan-checkout";
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

    const parsed = dokuDirectVaRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid direct VA request", parsed.error.format());
    }

    const planCheckout = await resolvePlanCheckout(parsed.data.metadata, parsed.data.amount);

    const vaRequest = {
      ...parsed.data,
      amount: planCheckout.amount,
      reusableStatus: false,
      customer: {
        id: parsed.data.customer.id || user.id.toString(),
        name: parsed.data.customer.name || user.name || "Customer",
        email: parsed.data.customer.email || user.email,
        phone: parsed.data.customer.phone?.trim() || DEFAULT_CUSTOMER_PHONE,
      },
    };

    try {
      const result = await createDokuDirectVa(config, vaRequest);

      // Find matching payment method if configured
      const method = await db.paymentMethod.findFirst({
        where: { code: result.bank },
        select: { id: true, name: true },
      });

      // Persist transaction record
      await db.paymentTransaction.create({
        data: {
          invoiceNumber: result.invoiceNumber,
          userId: user.id,
          paymentMethodId: method?.id || null,
          paymentMethodCode: result.bank,
          paymentMethodName: method?.name || `${result.bank.toUpperCase()} Virtual Account`,
          amount: result.amount,
          fee: 0,
          totalAmount: result.amount,
          currency: "IDR",
          status: "PENDING",
          paymentCode: result.virtualAccountNumber,
          howToPayUrl: result.howToPayPage || null,
          customerName: vaRequest.customer.name,
          customerEmail: vaRequest.customer.email,
          customerPhone: vaRequest.customer.phone || null,
          metadata: planCheckout.metadata as Prisma.InputJsonValue,
          gatewayResponse: result.rawResponse ? (result.rawResponse as Prisma.InputJsonValue) : undefined,
          expiredAt: new Date(Date.now() + 60 * 60 * 1000), // Strictly flat 1 hour
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
