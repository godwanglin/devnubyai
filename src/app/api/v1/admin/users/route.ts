import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import {
  listAdminUsers,
  createAdminUser,
  createAdminUserSchema,
} from "@/lib/users/admin-service";
import type { ListUsersFilter } from "@/lib/users/types";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const url = new URL(request.url);

    const filter: ListUsersFilter = {
      page: url.searchParams.get("page") ? parseInt(url.searchParams.get("page")!, 10) : 1,
      limit: url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!, 10) : 20,
      search: url.searchParams.get("search") || undefined,
      role: url.searchParams.get("role") || undefined,
      status: url.searchParams.get("status") || undefined,
      planId: url.searchParams.get("planId") || undefined,
      sortBy: (url.searchParams.get("sortBy") as ListUsersFilter["sortBy"]) || undefined,
      sortOrder: (url.searchParams.get("sortOrder") as ListUsersFilter["sortOrder"]) || undefined,
    };

    const result = await listAdminUsers(filter);
    return jsonSuccess(result, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const admin = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const parsed = createAdminUserSchema.parse(body);

    const user = await createAdminUser(parsed, admin.id);
    return jsonSuccess({ user }, { requestId, status: 201 });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
