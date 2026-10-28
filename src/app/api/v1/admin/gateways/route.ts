import { requireAdmin } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    // Defense-in-depth: requireAdmin verifies user authentication AND role='admin'
    await requireAdmin();

    const gateways = await db.gateway.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        baseUrl: true,
        wireApi: true,
        modelsPath: true,
        apiKeyLast4: true,
        isPrimary: true,
        isEnabled: true,
        priority: true,
        timeoutMs: true,
        firstTokenTimeoutMs: true,
        healthStatus: true,
        lastSuccessAt: true,
        lastFailureAt: true,
        lastSyncedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ isPrimary: "desc" }, { priority: "asc" }],
    });

    // Convert BigInt id to string for JSON serialization
    const serialized = gateways.map((g) => ({
      ...g,
      id: g.id.toString(),
    }));

    return jsonSuccess({ gateways: serialized }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
