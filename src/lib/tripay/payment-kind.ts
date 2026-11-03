import type { PaymentFlowType, PaymentMethodCategory } from "@/lib/payments/types";
import type { TripayInstruction, TripayPaymentKind } from "./types";

/** Client-safe: maps a stored Tripay method to how its invoice is paid */
export function tripayPaymentKind(method: {
  category: PaymentMethodCategory | string;
  flowType: PaymentFlowType | string;
  dokuCode?: string | null;
}): TripayPaymentKind {
  const code = (method.dokuCode || "").toUpperCase();
  if (code === "OVO") return "push";
  if (method.flowType === "checkout") return "redirect";
  if (method.category === "qris") return "qris";
  return "pay_code";
}

/** What the checkout API returns (and what a resumed pending invoice is rebuilt into) */
export interface TripayPaymentResult {
  invoiceNumber: string;
  kind: TripayPaymentKind;
  paymentName: string;
  customerPhone?: string | null;
  qrString?: string | null;
  payCode?: string | null;
  checkoutUrl?: string | null;
  instructions?: TripayInstruction[];
  amount: number;
  fee: number;
  totalAmount: number;
  expiredAt: string;
}
