import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { isOAuthProviderId } from "@/lib/oauth/providers";
import { exchangeManualCallback } from "@/lib/oauth/flow-service";
import { z } from "zod";

interface RouteContext {
  params: Promise<{ providerId: string }>;
}

const exchangeSchema = z.object({
  sessionId: z.string().min(1),
  callbackInput: z.string().min(1),
});

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const admin = await requireAdmin();
    const { providerId } = await context.params;

    if (!isOAuthProviderId(providerId)) {
      throw ApiError.notFound(`Unknown provider: ${providerId}`);
    }

    const body = await request.json().catch(() => ({}));
    const { sessionId, callbackInput } = exchangeSchema.parse(body);

    const result = await exchangeManualCallback(providerId, sessionId, callbackInput, admin.id);
    return jsonSuccess(result, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
