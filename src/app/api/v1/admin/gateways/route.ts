import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import {
  createAdminGateway,
  createGatewaySchema,
  listSanitizedGateways,
} from "@/lib/gateways/admin-service";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const gateways = await listSanitizedGateways();
    return jsonSuccess({ gateways }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const adminUser = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const parsed = createGatewaySchema.parse(body);

    const created = await createAdminGateway(parsed, adminUser.id);
    return jsonSuccess({ gateway: created }, { requestId, status: 201 });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
