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

/** QRIS channel codes Tripay offers (all DIRECT, Rp 1.000 – Rp 5.000.000) */
export const TRIPAY_QRIS_CHANNELS = ["QRIS", "QRIS2", "QRISC", "QRIS_SHOPEEPAY"] as const;
export type TripayQrisChannel = (typeof TRIPAY_QRIS_CHANNELS)[number];

export type TripayTransactionStatus = "UNPAID" | "PAID" | "EXPIRED" | "FAILED" | "REFUND";

export interface TripayCreateQrisRequest {
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
