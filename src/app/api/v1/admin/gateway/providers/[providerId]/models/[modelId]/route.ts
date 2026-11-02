import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { isOAuthProviderId } from "@/lib/oauth/providers";
import {
  deleteProviderModel,
  toggleProviderModelAvailable,
} from "@/lib/gateways/provider-models-service";
import { z } from "zod";

interface RouteContext {
  params: Promise<{ providerId: string; modelId: string }>;
}

const updateSchema = z.object({ isAvailable: z.boolean() });

export function parseModelId(raw: string): bigint {
  try {
    const id = BigInt(raw);
    if (id <= 0n) throw new Error();
    return id;
  } catch {
    throw ApiError.badRequest("Invalid model ID");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const admin = await requireAdmin();
    const { providerId, modelId } = await context.params;
    if (!isOAuthProviderId(providerId)) {
      throw ApiError.notFound(`Unknown provider: ${providerId}`);
    }

    const body = await request.json().catch(() => ({}));
    const parsed = updateSchema.parse(body);
    const model = await toggleProviderModelAvailable(providerId, parseModelId(modelId), parsed.isAvailable, admin.id);
    return jsonSuccess({ model }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const admin = await requireAdmin();
    const { providerId, modelId } = await context.params;
    if (!isOAuthProviderId(providerId)) {
      throw ApiError.notFound(`Unknown provider: ${providerId}`);
    }

    await deleteProviderModel(providerId, parseModelId(modelId), admin.id);
    return jsonSuccess({ deleted: true }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
