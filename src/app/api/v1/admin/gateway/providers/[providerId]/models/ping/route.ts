import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { isOAuthProviderId } from "@/lib/oauth/providers";
import { pingProviderModel } from "@/lib/gateways/provider-models-service";
import { z } from "zod";

interface RouteContext {
  params: Promise<{ providerId: string }>;
}

const pingSchema = z.object({
  modelKey: z.string().trim().min(1, "Model key required").max(128),
});

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    await requireAdmin();
    const { providerId } = await context.params;
    if (!isOAuthProviderId(providerId)) {
      throw ApiError.notFound(`Unknown provider: ${providerId}`);
    }

    const body = await request.json().catch(() => ({}));
    const parsed = pingSchema.parse(body);

    const result = await pingProviderModel(providerId, parsed.modelKey);
    return jsonSuccess({ ping: result }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
