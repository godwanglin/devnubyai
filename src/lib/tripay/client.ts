import crypto from "node:crypto";
import type {
  TripayChannel,
  TripayConfig,
  TripayCreateTransactionRequest,
  TripayTransactionData,
} from "./types";

const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_EXPIRY_MINUTES = 60;

export class TripayApiError extends Error {
  public readonly status: number;
  public readonly details?: unknown;

  constructor(message: string, status = 500, details?: unknown) {
    super(message);
    this.name = "TripayApiError";
    this.status = status;
    this.details = details;
  }
}

/** Closed-transaction signature: HMAC-SHA256(merchantCode + merchantRef + amount, privateKey) */
export function signClosedTransaction(
  config: Pick<TripayConfig, "merchantCode" | "privateKey">,
  merchantRef: string,
  amount: number
): string {
  return crypto
    .createHmac("sha256", config.privateKey)
    .update(`${config.merchantCode}${merchantRef}${amount}`)
    .digest("hex");
}

/** Callback signature: HMAC-SHA256 over the raw JSON body, compared in constant time */
export function verifyTripayCallbackSignature(
  privateKey: string,
  rawBody: string,
  signature: string | null
): boolean {
  if (!privateKey || !signature) return false;
  const expected = crypto.createHmac("sha256", privateKey).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function tripayRequest<T>(
  config: TripayConfig,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<T> {
  if (!config.isConfigured) {
    throw new TripayApiError("Tripay credentials are not configured", 400);
  }

  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}${path}`, {
      method: init.method || "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new TripayApiError(
      `Tripay request failed: ${err instanceof Error ? err.message : "network error"}`,
      502
    );
  }

  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; message?: string; data?: T }
    | null;
  if (!res.ok || !json?.success) {
    throw new TripayApiError(
      json?.message || `Tripay responded with HTTP ${res.status}`,
      res.status >= 400 && res.status < 500 ? 400 : 502,
      json
    );
  }
  return json.data as T;
}

/**
 * POST /transaction/create for any channel. Depending on the channel Tripay
 * returns `qr_string` (QRIS), `pay_code` (VA / retail) or `checkout_url` (e-wallet redirect).
 */
export async function createTripayTransaction(
  config: TripayConfig,
  input: TripayCreateTransactionRequest
): Promise<TripayTransactionData> {
  const expiresIn = input.expiresInMinutes ?? DEFAULT_EXPIRY_MINUTES;
  return tripayRequest<TripayTransactionData>(config, "/transaction/create", {
    method: "POST",
    body: {
      method: input.channel,
      merchant_ref: input.merchantRef,
      amount: input.amount,
      customer_name: input.customer.name,
      customer_email: input.customer.email,
      ...(input.customer.phone ? { customer_phone: input.customer.phone } : {}),
      order_items: input.items,
      callback_url: config.callbackUrl,
      ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
      expired_time: Math.floor(Date.now() / 1000) + expiresIn * 60,
      signature: signClosedTransaction(config, input.merchantRef, input.amount),
    },
  });
}

export async function getTripayTransactionDetail(
  config: TripayConfig,
  reference: string
): Promise<TripayTransactionData> {
  return tripayRequest<TripayTransactionData>(
    config,
    `/transaction/detail?reference=${encodeURIComponent(reference)}`
  );
}

/** Lists the merchant's channels (admin "test connection" and channel picker) */
export async function listTripayChannels(config: TripayConfig): Promise<TripayChannel[]> {
  return tripayRequest<TripayChannel[]>(config, "/merchant/payment-channel");
}
