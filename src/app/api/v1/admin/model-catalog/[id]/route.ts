import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import {
  deleteCatalogModel,
  getCatalogModelDetailAdmin,
  updateCatalogModel,
  updateCatalogModelSchema,
} from "@/lib/catalog-models/admin-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext
) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const { id: rawId } = await context.params;

    let id: bigint;
    try {
      id = BigInt(rawId);
    } catch {
      throw ApiError.badRequest("Invalid model ID");
    }

    const model = await getCatalogModelDetailAdmin(id);
    return jsonSuccess({ model }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext
) {
  const requestId = getRequestId(request);

  try {
    const adminUser = await requireAdmin();
    const { id: rawId } = await context.params;

    let id: bigint;
    try {
      id = BigInt(rawId);
    } catch {
      throw ApiError.badRequest("Invalid model ID");
    }

    const body = await request.json().catch(() => ({}));
    const parsed = updateCatalogModelSchema.parse(body);

    const model = await updateCatalogModel(id, parsed, adminUser.id);
    return jsonSuccess({ model }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext
) {
  const requestId = getRequestId(request);

  try {
    const adminUser = await requireAdmin();
    const { id: rawId } = await context.params;

    let id: bigint;
    try {
      id = BigInt(rawId);
    } catch {
      throw ApiError.badRequest("Invalid model ID");
    }

    await deleteCatalogModel(id, adminUser.id);
    return jsonSuccess({ success: true }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
