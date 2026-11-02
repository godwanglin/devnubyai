import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getDokuConfig } from "@/lib/doku/settings";
import { checkDokuOrderStatus } from "@/lib/doku/client";
import { applyDokuSettlement } from "@/lib/payments/settlement";

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
          if (dokuTx?.status === "SUCCESS" || dokuTx?.status === "FAILED") {
            const settled = await applyDokuSettlement(
              invoiceNumber,
              dokuTx.status === "SUCCESS" ? "PAID" : "FAILED",
              dokuStatus
            );
            if (settled) {
              status = settled.status;
              paidAt = settled.paidAt;
            }
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
