import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { testGatewayConnectivity } from "@/lib/gateways/admin-service";

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
    await requireAdmin();
    const { id: rawId } = await context.params;
    const gatewayId = parseGatewayId(rawId);

    const result = await testGatewayConnectivity(gatewayId);
    return jsonSuccess(result, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
