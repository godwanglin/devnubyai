import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import {
  deleteAdminGateway,
  getSanitizedGateway,
  updateAdminGateway,
  updateGatewaySchema,
} from "@/lib/gateways/admin-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function parseGatewayId(rawId: string): bigint {
  try {
    const id = BigInt(rawId);
    if (id <= BigInt(0)) throw new Error();
    return id;
  } catch {
    throw ApiError.badRequest("Invalid gateway ID parameter");
  }
}

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const { id: rawId } = await context.params;
    const gatewayId = parseGatewayId(rawId);

    const gateway = await getSanitizedGateway(gatewayId);
    return jsonSuccess({ gateway }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const adminUser = await requireAdmin();
    const { id: rawId } = await context.params;
    const gatewayId = parseGatewayId(rawId);

    const body = await request.json().catch(() => ({}));
    const parsed = updateGatewaySchema.parse(body);

    const updated = await updateAdminGateway(gatewayId, parsed, adminUser.id);
    return jsonSuccess({ gateway: updated }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const adminUser = await requireAdmin();
    const { id: rawId } = await context.params;
    const gatewayId = parseGatewayId(rawId);

    const result = await deleteAdminGateway(gatewayId, adminUser.id);
    return jsonSuccess(result, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
