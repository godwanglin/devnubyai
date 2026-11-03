import type { GatewayErrorDetails, RoutingErrorClass } from "@/lib/gateways/types";
import type { RoutingSettings } from "./settings";
import { mapProviderError } from "./error-mapping";

const RAW_PROVIDER_ERROR_MAX_CHARS = 2000;

/**
 * Raised by wire adapters for any failure before the first stream event.
 * Classification is mechanism only; whether it triggers fallback is decided
 * by `shouldFallback` from admin-managed settings.
 */
export class GatewayError extends Error implements GatewayErrorDetails {
  readonly errorClass: RoutingErrorClass;
  readonly httpStatus: number | null;
  readonly errorRuleId: string;
  readonly providerError: string;
  readonly clientError: string;
  /** Upstream response body as received (truncated), kept for admin logs only */
  readonly rawProviderError: string | null;
  readonly isRetryable: boolean;
  override readonly cause?: unknown;

  constructor(
    details: Omit<GatewayErrorDetails, "isRetryable"> & {
      isRetryable?: boolean;
      rawProviderText?: string | null;
    }
  ) {
    const mapped = mapProviderError({
      httpStatus: details.httpStatus,
      rawText: details.rawProviderText ?? details.message,
      clientAborted: details.errorClass === "client_aborted",
      timedOut: details.errorClass === "timeout",
      fallbackErrorClass: details.errorClass,
    });

    super(details.clientError ?? mapped.clientMessage);
    this.name = "GatewayError";
    this.errorClass = details.errorClass;
    this.httpStatus = details.httpStatus;
    this.errorRuleId = details.errorRuleId ?? mapped.ruleId;
    this.providerError = details.providerError ?? mapped.providerMessage;
    this.clientError = details.clientError ?? mapped.clientMessage;
    const raw = details.rawProviderText?.trim();
    this.rawProviderError = raw ? raw.slice(0, RAW_PROVIDER_ERROR_MAX_CHARS) : null;
    this.isRetryable = details.isRetryable ?? false;
    this.cause = details.cause;
  }
}

const MODEL_NOT_FOUND_PATTERN = /model[_\s-]?not[_\s-]?found|does not exist|unknown model|no such model/i;

/**
 * Detects upstream gateway / web-scraper quota and rate limit banners
 * such as "[ChatGPT Web]: Anda sudah mencapai batas. Silakan coba lagi nanti."
 */
export function isUpstreamRateLimitText(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (/\[ChatGPT\s*Web\]:?\s*Anda sudah mencapai batas/i.test(trimmed)) return true;
  if (/Anda sudah mencapai batas[.,\s]*Silakan coba lagi nanti/i.test(trimmed)) return true;
  if (
    /\[ChatGPT\s*Web\]/i.test(trimmed) &&
    /(?:mencapai batas|coba lagi nanti|rate limit|too many requests|quota|limit reached)/i.test(trimmed)
  ) {
    return true;
  }
  return false;
}

/**
 * Map an upstream HTTP error response to an error class.
 */
export function classifyHttpError(status: number, bodyText: string): RoutingErrorClass {
  if (status === 404 || MODEL_NOT_FOUND_PATTERN.test(bodyText)) return "model_not_found";
  if (status === 401 || status === 403) return "auth";
  if (status === 429 || isUpstreamRateLimitText(bodyText)) return "rate_limited";
  if (status === 408) return "timeout";
  if (status >= 500) return "http_5xx";
  if (status >= 400) return "bad_request";
  return "unknown";
}

/**
 * Map a thrown fetch/stream error to a GatewayError.
 * `timedOut` tells whether our own timeout controller fired (vs. the client).
 */
export function classifyThrownError(
  err: unknown,
  ctx: { timedOut: boolean; clientAborted: boolean }
): GatewayError {
  if (err instanceof GatewayError) return err;
  const message = err instanceof Error ? err.message : String(err);

  if (ctx.clientAborted) {
    return new GatewayError({ errorClass: "client_aborted", httpStatus: null, message, cause: err });
  }
  if (ctx.timedOut) {
    return new GatewayError({ errorClass: "timeout", httpStatus: null, message, cause: err });
  }
  return new GatewayError({ errorClass: "network", httpStatus: null, message, cause: err });
}

/**
 * Decide whether to try the next candidate, using only DB settings.
 */
export function shouldFallback(error: GatewayError, settings: RoutingSettings): boolean {
  if (error.errorClass === "client_aborted") return false;
  if (!settings.fallbackOnErrors.includes(error.errorClass)) return false;
  if (error.errorClass === "model_not_found") return settings.fallbackOnModelNotFound;
  if (error.httpStatus !== null && (error.errorClass === "http_5xx" || error.errorClass === "rate_limited")) {
    return settings.retryOnStatus.includes(error.httpStatus);
  }
  return true;
}
