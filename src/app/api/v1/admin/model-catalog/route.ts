import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import {
  createCatalogModel,
  createCatalogModelSchema,
  listCatalogModelsAdmin,
} from "@/lib/catalog-models/admin-service";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const { searchParams } = new URL(request.url);

    const models = await listCatalogModelsAdmin({
      search: searchParams.get("search") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      providerId: searchParams.get("providerId") ?? undefined,
    });

    return jsonSuccess({ models }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const adminUser = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const parsed = createCatalogModelSchema.parse(body);

    const model = await createCatalogModel(parsed, adminUser.id);
    return jsonSuccess({ model }, { requestId, status: 201 });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
