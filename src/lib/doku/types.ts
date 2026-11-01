export type DokuEnvironment = "sandbox" | "production";

export interface DokuConfig {
  isEnabled: boolean;
  environment: DokuEnvironment;
  clientId: string;
  secretKey: string;
  apiKey?: string;
  publicKey?: string;
  notificationUrl?: string;
  callbackUrl?: string;
}

export interface DokuPublicSettings {
  isEnabled: boolean;
  environment: DokuEnvironment;
  clientId: string;
  hasSecretKey: boolean;
  secretKeyLast4: string;
  hasApiKey: boolean;
  hasPublicKey: boolean;
  notificationUrl: string;
  callbackUrl: string;
  isConfigured: boolean;
  source: "database" | "environment" | "none";
}

export interface DokuCheckoutItem {
  name: string;
  price: number;
  quantity: number;
}

export interface DokuCheckoutCustomer {
  id?: string;
  name: string;
  email: string;
  phone?: string;
}

export interface DokuCheckoutRequest {
  invoiceNumber: string;
  amount: number;
  currency?: "IDR";
  customer: DokuCheckoutCustomer;
  items?: DokuCheckoutItem[];
  callbackUrl?: string;
  callbackUrlCancel?: string;
  lineItemsDescription?: string;
  paymentMethodTypes?: string[];
  metadata?: Record<string, unknown>;
}

export interface DokuCheckoutResponse {
  paymentUrl: string;
  invoiceNumber: string;
  amount: number;
  expiredDate?: string;
  rawResponse?: Record<string, unknown>;
}

export type DokuVaBank =
  | "bri"
  | "bca"
  | "mandiri"
  | "bni"
  | "permata"
  | "cimb"
  | "danamon"
  | "bsi"
  | "doku";

export interface DokuDirectVaRequest {
  invoiceNumber: string;
  amount: number;
  bank: DokuVaBank;
  customer: DokuCheckoutCustomer;
  expiredTimeMinutes?: number;
  reusableStatus?: boolean;
  info1?: string;
  info2?: string;
  info3?: string;
  metadata?: Record<string, unknown>;
}

export interface DokuDirectVaResponse {
  invoiceNumber: string;
  amount: number;
  bank: DokuVaBank;
  virtualAccountNumber: string;
  expiredDate?: string;
  expiredDateUtc?: string;
  howToPayPage?: string;
  howToPayApi?: string;
  rawResponse?: Record<string, unknown>;
}

export interface DokuNotificationPayload {
  service?: {
    id?: string;
  };
  acquirer?: {
    id?: string;
  };
  channel?: {
    id?: string;
  };
  order: {
    invoice_number: string;
    amount: number;
    currency?: string;
    callback_url?: string;
    line_items?: Array<{
      name: string;
      price: number;
      quantity: number;
    }>;
  };
  transaction?: {
    status: "SUCCESS" | "FAILED" | "PENDING";
    date?: string;
    original_request_id?: string;
  };
  virtual_account_info?: {
    virtual_account_number?: string;
    how_to_pay_page?: string;
  };
}
