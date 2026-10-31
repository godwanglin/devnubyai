import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";

export async function assertUserModelAccess(userId: bigint, catalogModelId: bigint): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      planId: true,
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

  let planId = user.planId;
  if (!planId) {
    const freePlan = await db.plan.findUnique({
      where: { slug: "free" },
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
    const planName = user.plan?.name || "Free";
    throw ApiError.forbidden(
      `Model ini tidak termasuk dalam ${planName} Anda. Silakan tingkatkan paket Anda ke Pro di /plans untuk mengaksesnya.`
    );
  }
}
