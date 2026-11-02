import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { isOAuthProviderId } from "@/lib/oauth/providers";
import {
  deleteConnection,
  updateConnection,
} from "@/lib/gateways/provider-service";
import { z } from "zod";

interface RouteContext {
  params: Promise<{ providerId: string; connectionId: string }>;
}

const updateSchema = z.object({
  isEnabled: z.boolean().optional(),
  label: z.string().trim().max(120).optional(),
});

function parseConnectionId(raw: string): bigint {
  try {
    const id = BigInt(raw);
    if (id <= 0n) throw new Error();
    return id;
  } catch {
    throw ApiError.badRequest("Invalid connection ID");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const admin = await requireAdmin();
    const { providerId, connectionId: rawConnId } = await context.params;

    if (!isOAuthProviderId(providerId)) {
      throw ApiError.notFound(`Unknown provider: ${providerId}`);
    }

    const connectionId = parseConnectionId(rawConnId);
    const body = await request.json().catch(() => ({}));
    const parsed = updateSchema.parse(body);

    const updated = await updateConnection(providerId, connectionId, parsed, admin.id);
    return jsonSuccess({ connection: updated }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const admin = await requireAdmin();
    const { providerId, connectionId: rawConnId } = await context.params;

    if (!isOAuthProviderId(providerId)) {
      throw ApiError.notFound(`Unknown provider: ${providerId}`);
    }

    const connectionId = parseConnectionId(rawConnId);
    await deleteConnection(providerId, connectionId, admin.id);

    return jsonSuccess({ deleted: true }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
