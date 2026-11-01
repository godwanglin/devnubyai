import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getDokuConfig } from "@/lib/doku/settings";
import { checkDokuOrderStatus } from "@/lib/doku/client";
import type { Prisma } from "@/generated/client";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const invoiceNumber = url.searchParams.get("invoiceNumber")?.trim();

    if (!invoiceNumber) {
      throw ApiError.badRequest("invoiceNumber parameter is required");
    }

    const tx = await db.paymentTransaction.findUnique({
      where: { invoiceNumber },
    });

    if (!tx) {
      throw ApiError.notFound("Payment transaction not found");
    }

    // Ensure transaction belongs to user or user is admin
    if (tx.userId !== user.id && user.role !== "admin") {
      throw ApiError.forbidden("Access denied");
    }

    let status = tx.status;
    let paidAt = tx.paidAt;

    // If still PENDING, attempt real-time check against DOKU status API
    if (status === "PENDING") {
      const { config } = await getDokuConfig();
      if (config.isEnabled && config.clientId && config.secretKey) {
        try {
          const dokuStatus = await checkDokuOrderStatus(config, invoiceNumber);
          const dokuTx = dokuStatus?.transaction as { status?: string } | undefined;
          if (dokuTx?.status === "SUCCESS") {
            status = "PAID";
            paidAt = new Date();

            await db.paymentTransaction.update({
              where: { invoiceNumber },
              data: {
                status: "PAID",
                paidAt,
                dokuResponse: dokuStatus as unknown as Prisma.InputJsonValue,
              },
            });

            // If transaction has plan metadata, activate plan
            const metadata = tx.metadata as Record<string, unknown> | null;
            const rawPlanId = metadata?.planId;
            if (rawPlanId && tx.userId) {
              try {
                await db.user.update({
                  where: { id: tx.userId },
                  data: { planId: BigInt(String(rawPlanId)) },
                });
              } catch (e) {
                console.error(`Failed to assign plan to user ${tx.userId}:`, e);
              }
            }
          } else if (dokuTx?.status === "FAILED") {
            status = "FAILED";
            await db.paymentTransaction.update({
              where: { invoiceNumber },
              data: { status: "FAILED" },
            });
          }
        } catch {
          // If check fails (e.g. not yet synced in DOKU or sandbox mock), fallback to DB status
        }
      }
    }

    return jsonSuccess(
      {
        invoiceNumber: tx.invoiceNumber,
        status,
        amount: tx.amount,
        paidAt: paidAt ? paidAt.toISOString() : null,
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
