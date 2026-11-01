import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDokuConfig } from "@/lib/doku/settings";
import { verifyDokuSignature } from "@/lib/doku/client";
import type { DokuNotificationPayload } from "@/lib/doku/types";
import type { Prisma } from "@/generated/client";

export async function POST(request: Request) {
  const targetPath = new URL(request.url).pathname;

  const clientId = request.headers.get("client-id") || request.headers.get("Client-Id") || "";
  const requestId = request.headers.get("request-id") || request.headers.get("Request-Id") || "";
  const requestTimestamp =
    request.headers.get("request-timestamp") || request.headers.get("Request-Timestamp") || "";
  const signature = request.headers.get("signature") || request.headers.get("Signature") || "";

  // Read raw text body strictly before any JSON parsing to keep byte-exact digest for signature
  const rawBody = await request.text();

  const { config } = await getDokuConfig();

  if (!config.secretKey) {
    return NextResponse.json(
      { error: "DOKU Secret Key is not configured on the server" },
      { status: 500 }
    );
  }

  const isSignatureValid = verifyDokuSignature({
    clientId: config.clientId || clientId,
    secretKey: config.secretKey,
    requestId,
    requestTimestamp,
    targetPath,
    rawBody,
    receivedSignature: signature,
  });

  if (!isSignatureValid) {
    return NextResponse.json(
      { error: "Invalid DOKU HMAC signature" },
      { status: 401 }
    );
  }

  let payload: DokuNotificationPayload | null = null;
  try {
    payload = JSON.parse(rawBody) as DokuNotificationPayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON notification body" },
      { status: 400 }
    );
  }

  const invoiceNumber = payload?.order?.invoice_number;
  const status = payload?.transaction?.status;
  const amount = payload?.order?.amount;

  if (invoiceNumber) {
    const isSuccess = status === "SUCCESS";
    const newStatus = isSuccess ? "PAID" : status === "FAILED" ? "FAILED" : "PENDING";

    const tx = await db.paymentTransaction.findUnique({
      where: { invoiceNumber },
    });

    if (tx) {
      await db.paymentTransaction.update({
        where: { invoiceNumber },
        data: {
          status: newStatus,
          dokuResponse: payload as unknown as Prisma.InputJsonValue,
          ...(isSuccess ? { paidAt: new Date() } : {}),
        },
      });

      if (isSuccess && tx.userId) {
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
    }
  }

  // DOKU expects 200 OK acknowledging receipt with correlation headers
  return NextResponse.json(
    {
      status: "SUCCESS",
      message: "Notification received and verified",
      invoice_number: invoiceNumber,
      amount,
    },
    {
      status: 200,
      headers: {
        "Client-Id": clientId,
        "Request-Id": requestId,
        "Request-Timestamp": requestTimestamp,
      },
    }
  );
}
