import { requireUser } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getDokuConfig } from "@/lib/doku/settings";
import { createDokuCheckout, DokuApiError } from "@/lib/doku/client";
import { dokuCheckoutRequestSchema } from "@/lib/doku/schemas";

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
        phone: parsed.data.customer.phone || "",
      },
    };

    try {
      const result = await createDokuCheckout(config, checkoutRequest);
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
