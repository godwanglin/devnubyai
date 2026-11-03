import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { isOAuthProviderId } from "@/lib/oauth/providers";
import {
  getProviderDetail,
  updateProviderCustomHeaders,
} from "@/lib/gateways/provider-service";
import { z } from "zod";

interface RouteContext {
  params: Promise<{ providerId: string }>;
}

const updateHeadersSchema = z
  .object({
    headers: z.record(z.string(), z.string()).optional(),
    customHeaders: z.record(z.string(), z.string()).optional(),
  })
  .refine(
    (data) => data.headers !== undefined || data.customHeaders !== undefined,
    { message: "Either headers or customHeaders must be provided" }
  )
  .transform((data) => ({
    headers: (data.headers ?? data.customHeaders ?? {}) as Record<string, string>,
  }));

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const admin = await requireAdmin();
    const { providerId } = await context.params;

    if (!isOAuthProviderId(providerId)) {
      throw ApiError.notFound(`Unknown provider: ${providerId}`);
    }

    const detail = await getProviderDetail(providerId, admin.id);
    return jsonSuccess({ provider: detail }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const admin = await requireAdmin();
    const { providerId } = await context.params;

    if (!isOAuthProviderId(providerId)) {
      throw ApiError.notFound(`Unknown provider: ${providerId}`);
    }

    const body = await request.json().catch(() => ({}));
    const parsed = updateHeadersSchema.parse(body);

    const updatedHeaders = await updateProviderCustomHeaders(
      providerId,
      parsed.headers,
      admin.id
    );

    return jsonSuccess({ headers: updatedHeaders }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
