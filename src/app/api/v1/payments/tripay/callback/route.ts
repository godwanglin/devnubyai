import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { applyPaymentSettlement } from "@/lib/payments/settlement";
import { getTripayConfig } from "@/lib/tripay/config";
import { verifyTripayCallbackSignature } from "@/lib/tripay/client";
import { mapTripayStatus } from "@/lib/tripay/schemas";
import type { TripayCallbackPayload } from "@/lib/tripay/types";

const MAX_CALLBACK_BYTES = 64 * 1024;

/**
 * POST /api/v1/payments/tripay/callback
 * Tripay payment-status callback. The HMAC over the raw body is the only trust
 * anchor; the transaction must match both merchant_ref and Tripay's reference.
 * Tripay retries until it receives `{ success: true }`.
 */
export async function POST(request: Request) {
  const config = getTripayConfig();
  const rawBody = (await request.text()).slice(0, MAX_CALLBACK_BYTES);

  if (
    !verifyTripayCallbackSignature(
      config.privateKey,
      rawBody,
      request.headers.get("x-callback-signature")
    )
  ) {
    return NextResponse.json({ success: false, message: "Invalid signature" }, { status: 401 });
  }

  if (request.headers.get("x-callback-event") !== "payment_status") {
    return NextResponse.json({ success: false, message: "Unsupported event" }, { status: 400 });
  }

  let payload: TripayCallbackPayload;
  try {
    payload = JSON.parse(rawBody) as TripayCallbackPayload;
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON" }, { status: 400 });
  }

  const tx = await db.paymentTransaction.findFirst({
    where: {
      invoiceNumber: String(payload.merchant_ref || ""),
      provider: "tripay",
      providerReference: String(payload.reference || ""),
    },
    select: { invoiceNumber: true, totalAmount: true },
  });
  if (!tx) {
    return NextResponse.json({ success: false, message: "Transaction not found" }, { status: 404 });
  }

  const status = mapTripayStatus(payload.status);
  if (status === "PAID" && payload.total_amount !== undefined && payload.total_amount < tx.totalAmount) {
    console.error(`[Tripay] paid amount mismatch for ${tx.invoiceNumber}`);
    return NextResponse.json({ success: false, message: "Amount mismatch" }, { status: 400 });
  }

  if (status !== "PENDING") {
    await applyPaymentSettlement(tx.invoiceNumber, status, payload);
  }

  return NextResponse.json({ success: true });
}
