import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { FREE_PLAN_SLUG, isPlanExpired } from "@/lib/plans/effective-plan";

export async function assertUserModelAccess(userId: bigint, catalogModelId: bigint): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      planId: true,
      planExpiresAt: true,
      plan: {
        select: {
          id: true,
          slug: true,
          name: true,
        },
      },
    },
  });

  if (!user) throw ApiError.unauthorized("User account not found");

  const expired = isPlanExpired(user.planExpiresAt);
  let planId = expired ? null : user.planId;
  if (!planId) {
    const freePlan = await db.plan.findUnique({
      where: { slug: FREE_PLAN_SLUG },
      select: { id: true },
    });
    planId = freePlan?.id ?? null;
  }

  if (!planId) {
    throw ApiError.forbidden("Akun Anda tidak memiliki paket langganan aktif.");
  }

  const access = await db.planModelAccess.findUnique({
    where: {
      planId_catalogModelId: {
        planId,
        catalogModelId,
      },
    },
  });

  if (!access) {
    const planName = (!expired && user.plan?.name) || "Free";
    throw ApiError.forbidden(
      `Model ini tidak termasuk dalam ${planName} Anda. Silakan tingkatkan paket Anda ke Pro di /plans untuk mengaksesnya.`
    );
  }
}
