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
    // OAuth gateways are managed under /admin/gateway/providers; only filters opt in to see them
    const includeOAuth = new URL(request.url).searchParams.get("includeOAuth") === "true";
    const gateways = await listSanitizedGateways({ includeOAuth });
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
