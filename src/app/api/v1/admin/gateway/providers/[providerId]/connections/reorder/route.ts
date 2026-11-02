import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { isOAuthProviderId } from "@/lib/oauth/providers";
import { reorderConnections } from "@/lib/gateways/provider-service";
import { z } from "zod";

interface RouteContext {
  params: Promise<{ providerId: string }>;
}

const reorderSchema = z.object({
  orderedIds: z.array(z.string().regex(/^\d+$/)).min(1),
});

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const admin = await requireAdmin();
    const { providerId } = await context.params;

    if (!isOAuthProviderId(providerId)) {
      throw ApiError.notFound(`Unknown provider: ${providerId}`);
    }

    const body = await request.json().catch(() => ({}));
    const parsed = reorderSchema.parse(body);

    const orderedBigInts = parsed.orderedIds.map((id) => BigInt(id));
    await reorderConnections(providerId, orderedBigInts, admin.id);

    return jsonSuccess({ reordered: true }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
