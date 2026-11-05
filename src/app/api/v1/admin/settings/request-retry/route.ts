import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { IMAGE_CATALOG_CATEGORY } from "@/lib/images/settings";
import {
  RoutingConfigError,
  getRoutingSettings,
  updateRequestRetrySettings,
} from "@/lib/routing/settings";

const patchSchema = z.object({
  requestRetryAttempts: z.number().int().min(1).max(10),
  fallbackModelPattern: z.string().max(200),
});

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const [settings, models] = await Promise.all([
      getRoutingSettings({ forceRefresh: true }),
      // Chat models in catalog order: the fallback candidates the pattern is matched against
      db.catalogModel.findMany({
        where: { status: "active", category: { not: IMAGE_CATALOG_CATEGORY } },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { publicId: true, displayName: true },
      }),
    ]);

    return jsonSuccess(
      {
        settings: {
          requestRetryAttempts: settings.requestRetryAttempts,
          fallbackModelPattern: settings.fallbackModelPattern,
        },
        models,
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);

  try {
    const adminUser = await requireAdmin();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw ApiError.badRequest("Invalid JSON body");
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid payload", parsed.error.format());
    }

    try {
      const settings = await updateRequestRetrySettings(parsed.data, adminUser.id);
      return jsonSuccess({ settings }, { requestId });
    } catch (err) {
      if (err instanceof RoutingConfigError) throw ApiError.badRequest(err.message);
      throw err;
    }
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
