import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import {
  createAdminPlan,
  createPlanSchema,
  listAdminPlans,
} from "@/lib/plans/admin-service";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const plans = await listAdminPlans();
    return jsonSuccess({ plans }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const adminUser = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const parsed = createPlanSchema.parse(body);

    const plan = await createAdminPlan(parsed, adminUser.id);
    return jsonSuccess({ plan }, { requestId, status: 201 });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
