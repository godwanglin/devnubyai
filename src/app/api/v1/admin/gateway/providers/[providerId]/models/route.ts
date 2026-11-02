import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { isOAuthProviderId } from "@/lib/oauth/providers";
import {
  listProviderModels,
  discoverProviderModels,
  importProviderModels,
} from "@/lib/gateways/provider-models-service";
import { z } from "zod";

interface RouteContext {
  params: Promise<{ providerId: string }>;
}

const importSchema = z.object({
  items: z
    .array(
      z.object({
        modelKey: z.string().trim().min(1).max(128),
        ownedBy: z.string().trim().max(128).optional().nullable(),
        rawMetadata: z.record(z.string(), z.unknown()).optional().nullable(),
      })
    )
    .min(1, "Minimal 1 model untuk di-import")
    .max(200, "Maksimal 200 model sekaligus"),
});

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    await requireAdmin();
    const { providerId } = await context.params;
    if (!isOAuthProviderId(providerId)) {
      throw ApiError.notFound(`Unknown provider: ${providerId}`);
    }

    const { searchParams } = new URL(request.url);
    if (searchParams.get("discover") === "true") {
      const discovered = await discoverProviderModels(providerId);
      return jsonSuccess(discovered, { requestId });
    }

    const models = await listProviderModels(providerId);
    return jsonSuccess({ models }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const admin = await requireAdmin();
    const { providerId } = await context.params;
    if (!isOAuthProviderId(providerId)) {
      throw ApiError.notFound(`Unknown provider: ${providerId}`);
    }

    const body = await request.json().catch(() => ({}));
    const parsed = importSchema.parse(body);

    const imported = await importProviderModels(providerId, parsed.items, admin.id);
    return jsonSuccess({ imported, count: imported.length }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
