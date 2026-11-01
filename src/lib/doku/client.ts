import crypto from "node:crypto";
import { DEFAULT_CUSTOMER_PHONE } from "./schemas";
import type {
  DokuConfig,
  DokuCheckoutRequest,
  DokuCheckoutResponse,
  DokuDirectVaRequest,
  DokuDirectVaResponse,
  DokuVaBank,
  DokuEnvironment,
} from "./types";

export const DOKU_BASE_URL: Record<DokuEnvironment, string> = {
  sandbox: "https://api-sandbox.doku.com",
  production: "https://api.doku.com",
};

export const DOKU_VA_BANK_PATHS: Record<DokuVaBank, string> = {
  bri: "/bri-virtual-account/v2/payment-code",
  bca: "/bca-virtual-account/v2/payment-code",
  mandiri: "/mandiri-virtual-account/v2/payment-code",
  bni: "/bni-virtual-account/v2/payment-code",
  permata: "/permata-virtual-account/v2/payment-code",
  cimb: "/cimb-virtual-account/v2/payment-code",
  danamon: "/danamon-virtual-account/v2/payment-code",
  bsi: "/bsm-virtual-account/v2/payment-code",
  doku: "/doku-virtual-account/v2/payment-code",
};

export class DokuApiError extends Error {
  public readonly status: number;
  public readonly details?: unknown;

  constructor(message: string, status = 500, details?: unknown) {
    super(message);
    this.name = "DokuApiError";
    this.status = status;
    this.details = details;
  }
}

/** Formats an ISO timestamp for DOKU (YYYY-MM-DDTHH:mm:ssZ) */
export function getDokuTimestamp(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Generates DOKU body digest: Base64(SHA256(rawBody)) */
export function generateDokuDigest(rawBody: string): string {
  return crypto.createHash("sha256").update(rawBody, "utf8").digest("base64");
}

export interface GenerateSignatureParams {
  clientId: string;
  secretKey: string;
  requestId: string;
  requestTimestamp: string;
  targetPath: string;
  rawBody?: string;
}

/**
 * Builds DOKU component signature string and calculates HMAC-SHA256 in Base64:
 *
 * Client-Id:{clientId}\n
 * Request-Id:{requestId}\n
 * Request-Timestamp:{requestTimestamp}\n
 * Request-Target:{targetPath}\n
 * Digest:{digest}
 */
export function generateDokuSignature({
  clientId,
  secretKey,
  requestId,
  requestTimestamp,
  targetPath,
  rawBody,
}: GenerateSignatureParams): string {
  const digest = rawBody ? generateDokuDigest(rawBody) : "";
  const components = [
    `Client-Id:${clientId}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${requestTimestamp}`,
    `Request-Target:${targetPath}`,
  ];

  if (digest) {
    components.push(`Digest:${digest}`);
  }

  const componentSignature = components.join("\n");
  const hmac = crypto
    .createHmac("sha256", secretKey)
    .update(componentSignature, "utf8")
    .digest("base64");

  return `HMACSHA256=${hmac}`;
}

export interface VerifySignatureParams {
  clientId: string;
  secretKey: string;
  requestId: string;
  requestTimestamp: string;
  targetPath: string;
  rawBody: string;
  receivedSignature: string;
}

/** Timing-safe verification of DOKU notification signature */
export function verifyDokuSignature({
  clientId,
  secretKey,
  requestId,
  requestTimestamp,
  targetPath,
  rawBody,
  receivedSignature,
}: VerifySignatureParams): boolean {
  if (!receivedSignature || !secretKey || !clientId) return false;

  const expectedSignature = generateDokuSignature({
    clientId,
    secretKey,
    requestId,
    requestTimestamp,
    targetPath,
    rawBody,
  });

  const expectedBuf = Buffer.from(expectedSignature, "utf8");
  const receivedBuf = Buffer.from(receivedSignature, "utf8");

  if (expectedBuf.length !== receivedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

/** Creates a DOKU Checkout payment session */
export async function createDokuCheckout(
  config: DokuConfig,
  request: DokuCheckoutRequest
): Promise<DokuCheckoutResponse> {
  if (!config.clientId || !config.secretKey) {
    throw new DokuApiError("DOKU credentials (Client ID and Secret Key) are not configured", 400);
  }

  const baseUrl = DOKU_BASE_URL[config.environment] || DOKU_BASE_URL.sandbox;
  const targetPath = "/checkout/v1/payment";
  const url = `${baseUrl}${targetPath}`;

  const requestId = crypto.randomUUID();
  const requestTimestamp = getDokuTimestamp();

  const payload = {
    order: {
      invoice_number: request.invoiceNumber,
      amount: request.amount,
      currency: request.currency || "IDR",
      callback_url: request.callbackUrl || config.callbackUrl,
      callback_url_cancel: request.callbackUrlCancel,
      line_items: request.items?.map((item) => ({
        name: item.name,
        price: item.price,
        quantity: item.quantity,
      })),
    },
    payment: {
      payment_due_date: 60, // 60 minutes default validity
      ...(request.paymentMethodTypes?.length
        ? { payment_method_types: request.paymentMethodTypes }
        : {}),
    },
    customer: {
      id: request.customer.id || `CUST-${crypto.randomBytes(4).toString("hex")}`,
      name: request.customer.name,
      email: request.customer.email,
      phone: request.customer.phone?.trim() || DEFAULT_CUSTOMER_PHONE,
    },
  };

  const rawBody = JSON.stringify(payload);
  const signature = generateDokuSignature({
    clientId: config.clientId,
    secretKey: config.secretKey,
    requestId,
    requestTimestamp,
    targetPath,
    rawBody,
  });

  const headers = {
    "Client-Id": config.clientId,
    "Request-Id": requestId,
    "Request-Timestamp": requestTimestamp,
    Signature: signature,
    "Content-Type": "application/json",
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: rawBody,
    });
  } catch (err) {
    throw new DokuApiError(
      `Failed to connect to DOKU API: ${err instanceof Error ? err.message : String(err)}`,
      502
    );
  }

  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    const errorMsg =
      (json?.error as { message?: string })?.message ||
      (json?.message as string) ||
      `DOKU API returned HTTP ${response.status}`;
    throw new DokuApiError(errorMsg, response.status, json);
  }

  // DOKU response structure: { response: { payment: { url: ... }, order: { ... } } }
  const resp = json?.response as
    | {
        payment?: { url?: string; expired_date?: string };
        order?: { invoice_number?: string; amount?: number };
      }
    | undefined;

  const paymentUrl = resp?.payment?.url;
  if (!paymentUrl) {
    throw new DokuApiError("Invalid response from DOKU: missing checkout payment URL", 502, json);
  }

  return {
    paymentUrl,
    invoiceNumber: resp?.order?.invoice_number || request.invoiceNumber,
    amount: resp?.order?.amount || request.amount,
    expiredDate: resp?.payment?.expired_date,
    rawResponse: json || undefined,
  };
}

/** Checks payment status for an invoice in DOKU */
export async function checkDokuOrderStatus(
  config: DokuConfig,
  invoiceNumber: string
): Promise<Record<string, unknown>> {
  if (!config.clientId || !config.secretKey) {
    throw new DokuApiError("DOKU credentials are not configured", 400);
  }

  const baseUrl = DOKU_BASE_URL[config.environment] || DOKU_BASE_URL.sandbox;
  const targetPath = `/orders/v1/status/${encodeURIComponent(invoiceNumber)}`;
  const url = `${baseUrl}${targetPath}`;

  const requestId = crypto.randomUUID();
  const requestTimestamp = getDokuTimestamp();

  const signature = generateDokuSignature({
    clientId: config.clientId,
    secretKey: config.secretKey,
    requestId,
    requestTimestamp,
    targetPath,
  });

  const headers = {
    "Client-Id": config.clientId,
    "Request-Id": requestId,
    "Request-Timestamp": requestTimestamp,
    Signature: signature,
  };

  const response = await fetch(url, { method: "GET", headers });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    const errorMsg =
      (json?.error as { message?: string })?.message ||
      (json?.message as string) ||
      `DOKU API error: HTTP ${response.status}`;
    throw new DokuApiError(errorMsg, response.status, json);
  }

  return json || {};
}

/** Creates a Direct Virtual Account payment code (e.g. BRIVA, BCA VA, etc.) */
export async function createDokuDirectVa(
  config: DokuConfig,
  request: DokuDirectVaRequest
): Promise<DokuDirectVaResponse> {
  if (!config.clientId || !config.secretKey) {
    throw new DokuApiError("DOKU credentials are not configured", 400);
  }

  const targetPath = DOKU_VA_BANK_PATHS[request.bank];
  if (!targetPath) {
    throw new DokuApiError(`Unsupported virtual account bank: ${request.bank}`, 400);
  }

  const baseUrl = DOKU_BASE_URL[config.environment] || DOKU_BASE_URL.sandbox;
  const url = `${baseUrl}${targetPath}`;

  const requestId = crypto.randomUUID();
  const requestTimestamp = getDokuTimestamp();

  const payload = {
    order: {
      invoice_number: request.invoiceNumber,
      amount: request.amount,
    },
    virtual_account_info: {
      expired_time: request.expiredTimeMinutes ?? 60,
      reusable_status: request.reusableStatus ?? false,
      info1: request.info1 || "DevNuby Payment",
      info2: request.info2 || request.customer.name,
      info3: request.info3 || "Terima Kasih",
    },
    customer: {
      name: request.customer.name,
      email: request.customer.email,
      phone: request.customer.phone?.trim() || DEFAULT_CUSTOMER_PHONE,
    },
  };

  const rawBody = JSON.stringify(payload);
  const signature = generateDokuSignature({
    clientId: config.clientId,
    secretKey: config.secretKey,
    requestId,
    requestTimestamp,
    targetPath,
    rawBody,
  });

  const headers = {
    "Client-Id": config.clientId,
    "Request-Id": requestId,
    "Request-Timestamp": requestTimestamp,
    Signature: signature,
    "Content-Type": "application/json",
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: rawBody,
    });
  } catch (err) {
    throw new DokuApiError(
      `Failed to connect to DOKU API: ${err instanceof Error ? err.message : String(err)}`,
      502
    );
  }

  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    const errorMsg =
      (json?.error as { message?: string })?.message ||
      (json?.message as string) ||
      `DOKU VA generation failed with HTTP ${response.status}`;
    throw new DokuApiError(errorMsg, response.status, json);
  }

  const vaInfo = json?.virtual_account_info as
    | {
        virtual_account_number?: string;
        how_to_pay_page?: string;
        how_to_pay_api?: string;
        created_date_utc?: string;
        expired_date_utc?: string;
      }
    | undefined;

  const vaNumber = vaInfo?.virtual_account_number;
  if (!vaNumber) {
    throw new DokuApiError("Invalid response from DOKU: missing virtual_account_number", 502, json);
  }

  return {
    invoiceNumber: request.invoiceNumber,
    amount: request.amount,
    bank: request.bank,
    virtualAccountNumber: vaNumber,
    expiredDate: vaInfo?.expired_date_utc,
    expiredDateUtc: vaInfo?.expired_date_utc,
    howToPayPage: vaInfo?.how_to_pay_page,
    howToPayApi: vaInfo?.how_to_pay_api,
    rawResponse: json || undefined,
  };
}
