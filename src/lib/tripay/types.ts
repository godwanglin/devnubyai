export type TripayMode = "sandbox" | "production";

export interface TripayConfig {
  isConfigured: boolean;
  mode: TripayMode;
  baseUrl: string;
  apiKey: string;
  privateKey: string;
  merchantCode: string;
  callbackUrl: string;
}

/** Masked view for the admin panel; never carries secrets */
export interface TripayPublicSettings {
  isConfigured: boolean;
  mode: TripayMode;
  merchantCode: string | null;
  apiKeyLast4: string | null;
  callbackUrl: string;
}

/** One row of GET /merchant/payment-channel (the merchant's enabled channels) */
export interface TripayChannel {
  group: string;
  code: string;
  name: string;
  type: "direct" | "redirect" | string;
  fee_customer?: { flat: number; percent: number | string };
  minimum_amount?: number | null;
  maximum_amount?: number | null;
  icon_url?: string | null;
  active: boolean;
}

/** How a Tripay channel is paid in our UI: QR payload, pay code (VA/retail), Tripay's hosted page, or push prompt (OVO) */
export type TripayPaymentKind = "qris" | "pay_code" | "redirect" | "push";

export type TripayTransactionStatus = "UNPAID" | "PAID" | "EXPIRED" | "FAILED" | "REFUND";

export interface TripayInstruction {
  title: string;
  steps: string[];
}

export interface TripayCreateTransactionRequest {
  channel: string;
  merchantRef: string;
  amount: number;
  customer: { name: string; email: string; phone?: string };
  items: Array<{ name: string; price: number; quantity: number }>;
  returnUrl?: string;
  expiresInMinutes?: number;
}

export interface TripayTransactionData {
  reference: string;
  merchant_ref: string;
  payment_method: string;
  payment_name?: string;
  amount: number;
  fee_customer?: number;
  fee_merchant?: number;
  total_fee?: number;
  amount_received?: number;
  status: TripayTransactionStatus;
  expired_time?: number;
  paid_at?: number | null;
  qr_string?: string | null;
  qr_url?: string | null;
  checkout_url?: string | null;
  pay_code?: string | null;
  pay_url?: string | null;
  instructions?: TripayInstruction[];
  [key: string]: unknown;
}

export interface TripayCallbackPayload {
  reference: string;
  merchant_ref: string;
  payment_method_code?: string;
  total_amount?: number;
  amount_received?: number;
  is_closed_payment?: number;
  status: TripayTransactionStatus;
  paid_at?: number | null;
  note?: string | null;
}
