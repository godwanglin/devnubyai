import { db } from "@/lib/db";
import type { Prisma } from "@/generated/client";
import { computePlanExpiry, type BillingCycle } from "@/lib/plans/effective-plan";
import { invalidateUserMeCache, invalidateUserQuotaCache } from "@/lib/redis/cache-keys";

export type DokuSettlementStatus = "PAID" | "FAILED" | "PENDING";

/**
 * Applies a DOKU status to a transaction exactly once.
 *
 * Only PENDING rows move, so replayed or out-of-order notifications can't
 * downgrade a settled invoice or grant its plan twice. The plan is granted
 * only by the caller whose conditional update flipped the row to PAID.
 */
export async function applyDokuSettlement(
  invoiceNumber: string,
  status: DokuSettlementStatus,
  dokuResponse: unknown
): Promise<{ status: string; paidAt: Date | null } | null> {
  const paidAt = status === "PAID" ? new Date() : undefined;
  const { count } = await db.paymentTransaction.updateMany({
    where: { invoiceNumber, status: "PENDING" },
    data: {
      status,
      dokuResponse: dokuResponse as Prisma.InputJsonValue,
      ...(paidAt ? { paidAt } : {}),
    },
  });

  const tx = await db.paymentTransaction.findUnique({
    where: { invoiceNumber },
    select: { userId: true, metadata: true, status: true, paidAt: true },
  });
  if (!tx) return null;

  if (count === 1 && status === "PAID" && tx.userId) {
    const metadata = tx.metadata as Record<string, unknown> | null;
    const rawPlanId = metadata?.planId;
    const cycle: BillingCycle = metadata?.cycle === "yearly" ? "yearly" : "monthly";
    if (rawPlanId) {
      try {
        const planId = BigInt(String(rawPlanId));
        const current = await db.user.findUnique({
          where: { id: tx.userId },
          select: { planId: true, planExpiresAt: true },
        });
        await db.user.update({
          where: { id: tx.userId },
          data: {
            planId,
            // The paid cycle sets (or extends) the expiry; afterwards the user falls back to free
            planExpiresAt: current ? computePlanExpiry(current, planId, cycle) : null,
          },
        });
        await Promise.allSettled([
          invalidateUserMeCache(tx.userId),
          invalidateUserQuotaCache(tx.userId),
        ]);
      } catch (e) {
        console.error(`Failed to assign plan to user ${tx.userId}:`, e);
      }
    }
  }

  return { status: tx.status, paidAt: tx.paidAt };
}
