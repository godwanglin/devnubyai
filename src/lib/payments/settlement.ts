import { db } from "@/lib/db";
import type { Prisma } from "@/generated/client";

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
    if (rawPlanId) {
      try {
        await db.user.update({
          where: { id: tx.userId },
          data: { planId: BigInt(String(rawPlanId)) },
        });
      } catch (e) {
        console.error(`Failed to assign plan to user ${tx.userId}:`, e);
      }
    }
  }

  return { status: tx.status, paidAt: tx.paidAt };
}
