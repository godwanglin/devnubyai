import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDokuConfig } from "@/lib/doku/settings";
import { checkDokuOrderStatus } from "@/lib/doku/client";
import { applyDokuSettlement } from "@/lib/payments/settlement";

const EXPIRATION_WINDOW_MS = 60 * 60 * 1000; // Flat 1 hour (60 minutes)

type RouteContext = {
  params: Promise<{ slug: string[] }>;
};

/** Resolves raw user string (BigInt ID or publicId UUID) to DB user BigInt id */
async function resolveUserId(rawId: string): Promise<bigint | null> {
  const cleanId = rawId.trim();
  if (!cleanId) return null;

  if (/^\d+$/.test(cleanId)) {
    try {
      const bId = BigInt(cleanId);
      const user = await db.user.findUnique({
        where: { id: bId },
        select: { id: true },
      });
      if (user) return user.id;
    } catch {
      // ignore
    }
  }

  const user = await db.user.findFirst({
    where: { publicId: cleanId },
    select: { id: true },
  });
  return user ? user.id : null;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { slug } = await context.params;
    if (!slug || slug.length === 0) {
      return NextResponse.json({ error: "Missing tracking path" }, { status: 400 });
    }

    const raw = decodeURIComponent(slug.join("/"));
    // Supports both colon-separated (pym:user-id:invoice:doku) and slash-separated (pym/user-id/invoice/doku)
    const parts = raw.includes(":") ? raw.split(":") : raw.split("/");

    const prefix = parts[0]?.trim().toLowerCase();
    if (prefix !== "pym") {
      return NextResponse.json(
        { error: "Invalid tracking prefix. Expected 'pym'." },
        { status: 400 }
      );
    }

    // ─────────────────────────────────────────────────────────────
    // 1. Initial Reload / Polling Check: /api/v1/tracking/pym:<user-id>
    // ─────────────────────────────────────────────────────────────
    if (parts.length === 2) {
      const rawUserId = parts[1]?.trim();
      const userId = await resolveUserId(rawUserId);

      if (!userId) {
        return NextResponse.json({ invoices: [] });
      }

      const pendingTxs = await db.paymentTransaction.findMany({
        where: {
          userId,
          status: "PENDING",
        },
        orderBy: { createdAt: "desc" },
      });

      const now = Date.now();
      const activeInvoices: Array<{
        invoice: string;
        status: string;
        type: string;
        amount: number;
        vaNumber?: string;
        bank?: string;
        checkoutUrl?: string;
        expiredAt?: string;
        createdAt: string;
      }> = [];

      for (const tx of pendingTxs) {
        const isExpired =
          (tx.expiredAt && tx.expiredAt.getTime() <= now) ||
          now - tx.createdAt.getTime() > EXPIRATION_WINDOW_MS;

        if (isExpired) {
          // Auto-mark expired transactions
          await db.paymentTransaction.update({
            where: { id: tx.id },
            data: { status: "EXPIRED" },
          });
        } else {
          activeInvoices.push({
            invoice: tx.invoiceNumber,
            status: "pending",
            type: "doku",
            amount: tx.totalAmount,
            vaNumber: tx.paymentCode || undefined,
            bank: tx.paymentMethodCode || undefined,
            checkoutUrl: tx.checkoutUrl || undefined,
            expiredAt: tx.expiredAt ? tx.expiredAt.toISOString() : undefined,
            createdAt: tx.createdAt.toISOString(),
          });
        }
      }

      return NextResponse.json({ invoices: activeInvoices });
    }

    // ─────────────────────────────────────────────────────────────
    // 2. Specific Invoice Pooling: /api/v1/tracking/pym:<user-id>:<invoice>:doku
    // ─────────────────────────────────────────────────────────────
    if (parts.length >= 3) {
      const rawUserId = parts[1]?.trim();
      const invoice = parts[2]?.trim();
      const type = (parts[3]?.trim() || "doku").toLowerCase();

      if (!invoice) {
        return NextResponse.json({ error: "Missing invoice parameter" }, { status: 400 });
      }

      const userId = await resolveUserId(rawUserId);
      const tx = await db.paymentTransaction.findUnique({
        where: { invoiceNumber: invoice },
      });

      if (!tx) {
        return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
      }

      // Check ownership if userId is valid
      if (userId && tx.userId && tx.userId !== userId) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }

      // Already settled statuses
      if (tx.status === "PAID") {
        return NextResponse.json({ invoice: tx.invoiceNumber, status: "success", type });
      }
      if (tx.status === "FAILED") {
        return NextResponse.json({ invoice: tx.invoiceNumber, status: "failed", type });
      }
      if (tx.status === "EXPIRED") {
        return NextResponse.json({ invoice: tx.invoiceNumber, status: "expired", type });
      }

      // Enforce flat 1-hour expiration check
      const now = Date.now();
      const isExpired =
        (tx.expiredAt && tx.expiredAt.getTime() <= now) ||
        now - tx.createdAt.getTime() > EXPIRATION_WINDOW_MS;

      if (isExpired) {
        await db.paymentTransaction.update({
          where: { id: tx.id },
          data: { status: "EXPIRED" },
        });
        return NextResponse.json({ invoice: tx.invoiceNumber, status: "expired", type });
      }

      // Real-time live status query to DOKU
      if (type === "doku") {
        const { config } = await getDokuConfig();
        if (config.isEnabled && config.clientId && config.secretKey) {
          try {
            const dokuStatus = await checkDokuOrderStatus(config, invoice);
            const rawStatus = (
              (dokuStatus?.transaction as { status?: string })?.status ||
              (dokuStatus?.order as { status?: string })?.status ||
              (dokuStatus?.status as string) ||
              ""
            ).toUpperCase();

            if (rawStatus === "SUCCESS") {
              const settled = await applyDokuSettlement(invoice, "PAID", dokuStatus);
              return NextResponse.json({
                invoice: tx.invoiceNumber,
                status: settled?.status === "PAID" ? "success" : "pending",
                type,
              });
            } else if (rawStatus === "FAILED") {
              await applyDokuSettlement(invoice, "FAILED", dokuStatus);
              return NextResponse.json({ invoice: tx.invoiceNumber, status: "failed", type });
            } else if (rawStatus === "EXPIRED") {
              await db.paymentTransaction.update({
                where: { id: tx.id },
                data: { status: "EXPIRED" },
              });
              return NextResponse.json({ invoice: tx.invoiceNumber, status: "expired", type });
            }
          } catch (err) {
            // If DOKU status API encounters error or rate-limit, keep returning DB state
            console.warn(`[Tracking] DOKU order status check error for ${invoice}:`, err);
          }
        }
      }

      // Still pending
      return NextResponse.json({ invoice: tx.invoiceNumber, status: "pending", type });
    }

    return NextResponse.json({ error: "Invalid tracking path format" }, { status: 400 });
  } catch (err) {
    console.error("[Tracking] Route handler error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
