import { z } from "zod";
import { db } from "@/lib/db";
import { reconfigureDbPool } from "@/lib/db";
import { getDbPoolConfig, saveDbPoolConfig } from "@/lib/db/pool-config";
import { requireAdmin } from "@/lib/auth/session";
import { recordAdminAudit } from "@/lib/admin/audit";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";

const updatePoolSchema = z.object({
  max: z.number().int().min(5, "Minimal 5 koneksi").max(100, "Maksimal 100 koneksi"),
  connectionTimeoutSeconds: z.number().int().min(3, "Minimal 3 detik").max(60, "Maksimal 60 detik"),
  idleTimeoutSeconds: z.number().int().min(5, "Minimal 5 detik").max(300, "Maksimal 300 detik"),
});

async function getLiveDbStats() {
  try {
    const [connResult, maxResult] = await Promise.all([
      db.$queryRawUnsafe<{ count: string | bigint }[]>("SELECT count(*) as count FROM pg_stat_activity;"),
      db.$queryRawUnsafe<{ max_connections: string }[]>("SHOW max_connections;"),
    ]);

    const activeCount = Number(connResult[0]?.count ?? 0);
    const serverMax = Number(maxResult[0]?.max_connections ?? 100);

    return {
      activeConnections: activeCount,
      serverMaxConnections: serverMax,
    };
  } catch (err) {
    console.warn("[LIVE_DB_STATS_WARN]", err);
    return {
      activeConnections: null,
      serverMaxConnections: 100,
    };
  }
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const poolConfig = getDbPoolConfig();
    const liveStats = await getLiveDbStats();

    return jsonSuccess({ poolConfig, liveStats }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);

  try {
    const admin = await requireAdmin();

    const body = await request.json().catch(() => ({}));
    const parsed = updatePoolSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Payload konfigurasi pool tidak valid", parsed.error.format());
    }

    const beforeConfig = getDbPoolConfig();
    const updatedConfig = await saveDbPoolConfig(parsed.data);

    // Apply runtime hot-swap of the connection pool
    reconfigureDbPool();

    await recordAdminAudit({
      actorUserId: admin.id,
      action: "database_pool.update",
      entityType: "app_setting",
      entityId: "database_pool",
      beforeState: beforeConfig as unknown as Record<string, unknown>,
      afterState: updatedConfig as unknown as Record<string, unknown>,
    });

    const liveStats = await getLiveDbStats();

    return jsonSuccess({ poolConfig: updatedConfig, liveStats }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
