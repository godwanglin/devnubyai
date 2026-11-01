import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { recordAdminAudit } from "@/lib/admin/audit";
import {
  invalidateUserQuotaCache,
  invalidateUserSessionsCache,
} from "@/lib/redis/cache-keys";
import { parseUserId } from "./admin-schemas";

export async function revokeAdminUserSessions(
  idOrPublicId: string,
  actorUserId: bigint
): Promise<{ revokedCount: number }> {
  const where = parseUserId(idOrPublicId);
  const user = await db.user.findFirst({ where, select: { id: true, email: true } });
  if (!user) throw ApiError.notFound("User tidak ditemukan");

  const result = await db.authSession.deleteMany({ where: { userId: user.id } });

  await recordAdminAudit({
    actorUserId,
    action: "revoke_sessions",
    entityType: "user",
    entityId: user.id.toString(),
    afterState: { revokedCount: result.count, userEmail: user.email },
  });

  await invalidateUserSessionsCache(user.id);

  return { revokedCount: result.count };
}

export async function resetAdminUserQuota(
  idOrPublicId: string,
  actorUserId: bigint
): Promise<{ success: boolean }> {
  const where = parseUserId(idOrPublicId);
  const user = await db.user.findFirst({ where, select: { id: true, email: true } });
  if (!user) throw ApiError.notFound("User tidak ditemukan");

  await Promise.all([
    db.userUsageWindow.deleteMany({ where: { userId: user.id } }),
    db.userUsagePeriod.deleteMany({ where: { userId: user.id } }),
  ]);

  await recordAdminAudit({
    actorUserId,
    action: "reset_quota",
    entityType: "user",
    entityId: user.id.toString(),
    afterState: { userEmail: user.email },
  });

  await invalidateUserQuotaCache(user.id);

  return { success: true };
}

export async function deleteAdminUser(
  idOrPublicId: string,
  actorUserId: bigint
): Promise<{ success: boolean }> {
  const where = parseUserId(idOrPublicId);
  const user = await db.user.findFirst({ where, select: { id: true, email: true } });
  if (!user) throw ApiError.notFound("User tidak ditemukan");

  if (user.id === actorUserId) {
    throw ApiError.badRequest("Anda tidak dapat menghapus akun Anda sendiri");
  }

  await db.user.delete({ where: { id: user.id } });

  await recordAdminAudit({
    actorUserId,
    action: "delete",
    entityType: "user",
    entityId: user.id.toString(),
    beforeState: { userEmail: user.email },
  });

  return { success: true };
}
