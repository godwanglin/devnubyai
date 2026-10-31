import { db } from "@/lib/db";
import { recordAdminAudit } from "@/lib/admin/audit";
import type {
  PaymentTransactionItem,
  PaymentTransactionStatus,
  TransactionSummaryStats,
} from "./types";
import type { PaymentTransactionManualStatusInput } from "./schemas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTransactionItem(record: any): PaymentTransactionItem {
  return {
    id: record.id.toString(),
    publicId: record.publicId,
    invoiceNumber: record.invoiceNumber,
    userId: record.userId ? record.userId.toString() : null,
    paymentMethodId: record.paymentMethodId ? record.paymentMethodId.toString() : null,
    paymentMethodCode: record.paymentMethodCode,
    paymentMethodName: record.paymentMethodName,
    amount: Number(record.amount),
    fee: Number(record.fee),
    totalAmount: Number(record.totalAmount),
    currency: record.currency,
    status: record.status as PaymentTransactionStatus,
    paymentCode: record.paymentCode,
    checkoutUrl: record.checkoutUrl,
    qrContent: record.qrContent,
    howToPayUrl: record.howToPayUrl,
    customerName: record.customerName,
    customerEmail: record.customerEmail,
    customerPhone: record.customerPhone,
    metadata: (record.metadata as Record<string, unknown>) || null,
    dokuResponse: (record.dokuResponse as Record<string, unknown>) || null,
    manualNotes: record.manualNotes,
    manualUpdatedBy: record.manualUpdatedByUser
      ? {
          id: record.manualUpdatedByUser.id.toString(),
          name: record.manualUpdatedByUser.name,
          email: record.manualUpdatedByUser.email,
        }
      : null,
    manualUpdatedAt: record.manualUpdatedAt ? record.manualUpdatedAt.toISOString() : null,
    paidAt: record.paidAt ? record.paidAt.toISOString() : null,
    expiredAt: record.expiredAt ? record.expiredAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export interface ListTransactionsOptions {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
}

export async function listPaymentTransactions(options: ListTransactionsOptions = {}): Promise<{
  transactions: PaymentTransactionItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}> {
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 20));
  const skip = (page - 1) * limit;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (options.status && options.status !== "ALL") {
    where.status = options.status;
  }

  if (options.search && options.search.trim()) {
    const q = options.search.trim();
    where.OR = [
      { invoiceNumber: { contains: q } },
      { customerName: { contains: q } },
      { customerEmail: { contains: q } },
      { paymentCode: { contains: q } },
      { paymentMethodName: { contains: q } },
    ];
  }

  if (options.fromDate || options.toDate) {
    where.createdAt = {};
    if (options.fromDate) {
      where.createdAt.gte = new Date(options.fromDate);
    }
    if (options.toDate) {
      const end = new Date(options.toDate);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

  const [total, records] = await Promise.all([
    db.paymentTransaction.count({ where }),
    db.paymentTransaction.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        manualUpdatedByUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    }),
  ]);

  return {
    transactions: records.map(toTransactionItem),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export async function getTransactionStats(): Promise<TransactionSummaryStats> {
  const [totalCount, paidCount, pendingCount, failedCount, volumeAgg] = await Promise.all([
    db.paymentTransaction.count(),
    db.paymentTransaction.count({ where: { status: "PAID" } }),
    db.paymentTransaction.count({ where: { status: "PENDING" } }),
    db.paymentTransaction.count({ where: { status: { in: ["FAILED", "EXPIRED", "CANCELLED"] } } }),
    db.paymentTransaction.aggregate({
      _sum: { totalAmount: true },
    }),
  ]);

  const paidVolumeAgg = await db.paymentTransaction.aggregate({
    where: { status: "PAID" },
    _sum: { totalAmount: true },
  });

  return {
    totalCount,
    paidCount,
    pendingCount,
    failedCount,
    totalVolume: volumeAgg._sum.totalAmount ? Number(volumeAgg._sum.totalAmount) : 0,
    paidVolume: paidVolumeAgg._sum.totalAmount ? Number(paidVolumeAgg._sum.totalAmount) : 0,
  };
}

export async function getPaymentTransactionByPublicId(
  publicId: string
): Promise<PaymentTransactionItem | null> {
  const record = await db.paymentTransaction.findUnique({
    where: { publicId },
    include: {
      manualUpdatedByUser: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  return record ? toTransactionItem(record) : null;
}

export async function updateTransactionStatusManually(
  publicId: string,
  input: PaymentTransactionManualStatusInput,
  actorUser: { id: bigint; name: string }
): Promise<PaymentTransactionItem> {
  const current = await db.paymentTransaction.findUnique({
    where: { publicId },
  });
  if (!current) {
    throw new Error("Transaksi tidak ditemukan");
  }

  const now = new Date();
  const isMarkingPaid = input.status === "PAID" && current.status !== "PAID";

  const updated = await db.paymentTransaction.update({
    where: { publicId },
    data: {
      status: input.status,
      manualNotes: input.notes,
      manualUpdatedBy: actorUser.id,
      manualUpdatedAt: now,
      paidAt: isMarkingPaid ? now : current.paidAt,
    },
    include: {
      manualUpdatedByUser: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  await recordAdminAudit({
    actorUserId: actorUser.id,
    action: "payment_transaction.manual_status_update",
    entityType: "payment_transaction",
    entityId: publicId,
    beforeState: { status: current.status, invoiceNumber: current.invoiceNumber },
    afterState: {
      status: updated.status,
      notes: input.notes,
      updatedBy: actorUser.name,
    },
  });

  return toTransactionItem(updated);
}
