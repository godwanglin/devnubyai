import { db } from "@/lib/db";
import type { Prisma } from "@/generated/client";
import { computePlanExpiry, type BillingCycle } from "@/lib/plans/effective-plan";
import { invalidateUserMeCache, invalidateUserQuotaCache } from "@/lib/redis/cache-keys";

export type PaymentSettlementStatus = "PAID" | "FAILED" | "EXPIRED" | "PENDING";

/**
 * Applies a gateway status (DOKU or Tripay) to a transaction exactly once.
 *
 * Only PENDING rows move, so replayed or out-of-order notifications can't
 * downgrade a settled invoice or grant its plan twice. The plan is granted
 * only by the caller whose conditional update flipped the row to PAID; the
 * purchase also starts the user's usage windows (5h / weekly / monthly) fresh.
 */
export async function applyPaymentSettlement(
  invoiceNumber: string,
  status: PaymentSettlementStatus,
  gatewayResponse: unknown
): Promise<{ status: string; paidAt: Date | null } | null> {
  const paidAt = status === "PAID" ? new Date() : undefined;
  const { count } = await db.paymentTransaction.updateMany({
    where: { invoiceNumber, status: "PENDING" },
    data: {
      status,
      gatewayResponse: gatewayResponse as Prisma.InputJsonValue,
      ...(paidAt ? { paidAt } : {}),
    },
  });

  const tx = await db.paymentTransaction.findUnique({
    where: { invoiceNumber },
    select: { userId: true, metadata: true, status: true, paidAt: true },
  });
  if (!tx) return null;

  if (count === 1 && status === "PAID" && tx.userId) {
    const userId = tx.userId;
    const metadata = tx.metadata as Record<string, unknown> | null;
    const rawPlanId = metadata?.planId;
    const cycle: BillingCycle = metadata?.cycle === "yearly" ? "yearly" : "monthly";
    if (rawPlanId) {
      try {
        const planId = BigInt(String(rawPlanId));
        const current = await db.user.findUnique({
          where: { id: userId },
          select: { planId: true, planExpiresAt: true },
        });
        await db.$transaction([
          db.user.update({
            where: { id: userId },
            data: {
              planId,
              // The paid cycle sets (or extends) the expiry; afterwards the user falls back to free
              planExpiresAt: current ? computePlanExpiry(current, planId, cycle) : null,
            },
          }),
          db.userUsageWindow.deleteMany({ where: { userId } }),
          db.userUsagePeriod.deleteMany({ where: { userId } }),
        ]);
        await Promise.allSettled([
          invalidateUserMeCache(userId),
          invalidateUserQuotaCache(userId),
        ]);
      } catch (e) {
        console.error(`Failed to assign plan to user ${userId}:`, e);
      }
    }
  }

  return { status: tx.status, paidAt: tx.paidAt };
}
