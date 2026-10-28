import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { resetGatewayCircuit } from "@/lib/gateways/admin-service";

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

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const adminUser = await requireAdmin();
    const { id: rawId } = await context.params;
    const gatewayId = parseGatewayId(rawId);

    const updated = await resetGatewayCircuit(gatewayId, adminUser.id);
    return jsonSuccess({ gateway: updated }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
