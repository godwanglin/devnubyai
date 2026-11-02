import type { TripayConfig, TripayMode, TripayPublicSettings } from "./types";

export const TRIPAY_BASE_URL: Record<TripayMode, string> = {
  sandbox: "https://tripay.co.id/api-sandbox",
  production: "https://tripay.co.id/api",
};

/**
 * Tripay credentials come from the environment; `TRIPAY_MODE` switches between
 * sandbox and production (each mode has its own key set in the Tripay dashboard).
 */
export function getTripayConfig(): TripayConfig {
  const mode: TripayMode =
    process.env.TRIPAY_MODE?.trim().toLowerCase() === "production" ? "production" : "sandbox";
  const apiKey = process.env.TRIPAY_API_KEY?.trim() || "";
  const privateKey = process.env.TRIPAY_PRIVATE_KEY?.trim() || "";
  const merchantCode = process.env.TRIPAY_MERCHANT_CODE?.trim() || "";
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");

  return {
    isConfigured: Boolean(apiKey && privateKey && merchantCode),
    mode,
    baseUrl: TRIPAY_BASE_URL[mode],
    apiKey,
    privateKey,
    merchantCode,
    callbackUrl:
      process.env.TRIPAY_CALLBACK_URL?.trim() || `${appUrl}/api/v1/payments/tripay/callback`,
  };
}

export function getTripayPublicSettings(): TripayPublicSettings {
  const config = getTripayConfig();
  return {
    isConfigured: config.isConfigured,
    mode: config.mode,
    merchantCode: config.merchantCode || null,
    apiKeyLast4: config.apiKey ? config.apiKey.slice(-4) : null,
    callbackUrl: config.callbackUrl,
  };
}
