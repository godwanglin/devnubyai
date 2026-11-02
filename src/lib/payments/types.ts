export type PaymentMethodCategory =
  | "virtual_account"
  | "qris"
  | "ewallet"
  | "retail"
  | "card";

export type PaymentFlowType = "direct" | "checkout";

/** Gateway that serves a method; Tripay is QRIS-only */
export type PaymentProvider = "doku" | "tripay";

export type PaymentTransactionStatus =
  | "PENDING"
  | "PAID"
  | "EXPIRED"
  | "FAILED"
  | "CANCELLED"
  | "REFUNDED";

export interface PaymentMethodItem {
  id: string;
  publicId: string;
  name: string;
  code: string;
  category: PaymentMethodCategory;
  provider: PaymentProvider;
  dokuCode: string | null;
  flowType: PaymentFlowType;
  imagePath: string | null;
  imageUrl: string;
  description: string | null;
  instructions: string | null;
  minAmount: number;
  maxAmount: number | null;
  feeType: "none" | "flat" | "percent";
  feeValue: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentTransactionItem {
  id: string;
  publicId: string;
  invoiceNumber: string;
  userId: string | null;
  paymentMethodId: string | null;
  paymentMethodCode: string;
  paymentMethodName: string;
  amount: number;
  fee: number;
  totalAmount: number;
  currency: string;
  status: PaymentTransactionStatus;
  paymentCode: string | null;
  checkoutUrl: string | null;
  qrContent: string | null;
  howToPayUrl: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  metadata: Record<string, unknown> | null;
  gatewayResponse: Record<string, unknown> | null;
  manualNotes: string | null;
  manualUpdatedBy: {
    id: string;
    name: string;
    email: string;
  } | null;
  manualUpdatedAt: string | null;
  paidAt: string | null;
  expiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionSummaryStats {
  totalCount: number;
  paidCount: number;
  pendingCount: number;
  failedCount: number;
  totalVolume: number;
  paidVolume: number;
}
