import type { RoutingErrorClass } from "@/lib/gateways/types";

export interface ErrorMappingRule {
  /** Unique identifier for this mapping rule */
  id: string;
  /** Optional HTTP status code(s) that trigger this rule */
  httpStatus?: number | number[];
  /** Case-insensitive substring patterns matched against raw upstream response */
  matchPatterns?: string[];
  /** If true, both httpStatus AND at least one matchPattern must match (when both are defined) */
  requireBothStatusAndPattern?: boolean;
  /** Internal routing classification used by fallback & circuit breaker */
  errorClass: RoutingErrorClass;
  /** Clean, standardized provider error message shown in Admin Telemetry Logs */
  providerMessage: string;
  /** Safe, user-friendly error message returned to the Client UI when all candidates fail */
  clientMessage: string;
}

export interface MappedErrorResult {
  ruleId: string;
  errorClass: RoutingErrorClass;
  providerMessage: string;
  clientMessage: string;
}

/**
 * Global fallback error used whenever an upstream error does not match any rule in ERROR_MAPPING_RULES.
 * Update this or add new entries to ERROR_MAPPING_RULES over time as new provider error patterns appear.
 */
export const GLOBAL_DEFAULT_ERROR: MappedErrorResult = {
  ruleId: "global_default",
  errorClass: "unknown",
  providerMessage: "Unmapped upstream provider error",
  clientMessage: "Model sedang tidak tersedia sementara. Silakan coba lagi beberapa saat.",
};

/**
 * Central mapping table for upstream provider errors and client-facing error messages.
 * Rules are evaluated in order from top to bottom.
 */
export const ERROR_MAPPING_RULES: ErrorMappingRule[] = [
  {
    id: "client_aborted",
    matchPatterns: ["client_aborted", "client stopped generation"],
    errorClass: "client_aborted",
    providerMessage: "Request Aborted by Client",
    clientMessage: "Generasi pesan dihentikan oleh pengguna.",
  },
  {
    id: "chatgpt_web_limit",
    matchPatterns: ["[chatgpt web]", "anda sudah mencapai batas"],
    errorClass: "rate_limited",
    providerMessage: "Upstream Web Session Quota / Rate Limit Reached",
    clientMessage: "Batas penggunaan model ini sedang penuh. Silakan coba lagi nanti atau ganti model lain.",
  },
  {
    id: "model_not_found",
    httpStatus: 404,
    matchPatterns: ["model_not_found", "model not found", "does not exist", "unknown model", "no such model"],
    errorClass: "model_not_found",
    providerMessage: "Upstream Model Not Found or Unavailable (404)",
    clientMessage: "Model yang dipilih sedang dalam pemeliharaan. Silakan pilih model lain.",
  },
  {
    id: "context_length_exceeded",
    httpStatus: [400, 413, 422],
    matchPatterns: [
      "context_length_exceeded",
      "maximum context length",
      "too many tokens",
      "prompt is too long",
      "context window",
    ],
    requireBothStatusAndPattern: true,
    errorClass: "bad_request",
    providerMessage: "Context Window / Token Limit Exceeded (400)",
    clientMessage: "Panjang percakapan melebihi batas memori model. Silakan mulai percakapan baru.",
  },
  {
    id: "unsupported_parameter_400",
    httpStatus: [400, 422],
    matchPatterns: [
      "unsupported parameter",
      "unknown parameter",
      "reasoning_effort",
      "invalid_value",
      "unrecognized request argument",
    ],
    requireBothStatusAndPattern: true,
    errorClass: "bad_request",
    providerMessage: "Unsupported Model Parameter in Request (400)",
    clientMessage: "Permintaan tidak dapat diproses oleh konfigurasi model ini. Silakan coba lagi atau ganti model.",
  },
  {
    id: "content_filter_400",
    httpStatus: [400, 403, 422],
    matchPatterns: ["content_filter", "content_policy", "safety system", "moderation"],
    requireBothStatusAndPattern: true,
    errorClass: "bad_request",
    providerMessage: "Upstream Content Filter / Moderation Triggered",
    clientMessage: "Permintaan ditolak oleh filter keamanan model. Silakan ubah isi pesan Anda.",
  },
  {
    id: "invalid_request_400",
    httpStatus: [400, 422],
    matchPatterns: ["invalid_request_error", "bad_request", "invalid request"],
    errorClass: "bad_request",
    providerMessage: "Upstream Bad Request / Invalid Payload (400)",
    clientMessage: "Permintaan tidak dapat diproses oleh model saat ini. Silakan coba lagi.",
  },
  {
    id: "upstream_auth_401_403",
    httpStatus: [401, 403],
    matchPatterns: [
      "invalid_api_key",
      "unauthorized",
      "forbidden",
      "authentication_error",
      "permission_error",
      "insufficient_quota",
      "credit balance is too low",
    ],
    errorClass: "auth",
    providerMessage: "Gateway Authentication / Quota Credential Error (401/403)",
    clientMessage: GLOBAL_DEFAULT_ERROR.clientMessage,
  },
  {
    id: "upstream_rate_limit_429",
    httpStatus: 429,
    matchPatterns: ["rate_limit", "rate limit", "too many requests", "quota_exceeded", "overloaded", "tpm", "rpm"],
    errorClass: "rate_limited",
    providerMessage: "Upstream Provider Rate Limit Exceeded (429)",
    clientMessage: "Server model sedang sibuk (antrean penuh). Silakan coba lagi dalam beberapa saat.",
  },
  {
    id: "upstream_timeout",
    httpStatus: [408, 504],
    matchPatterns: ["timeout", "timed out", "deadline exceeded", "first token timeout"],
    errorClass: "timeout",
    providerMessage: "Upstream Gateway Timeout",
    clientMessage: "Waktu tunggu respons model habis (timeout). Silakan coba kirim ulang pesan Anda.",
  },
  {
    id: "upstream_5xx",
    httpStatus: [500, 502, 503],
    matchPatterns: ["internal_error", "server_error", "bad gateway", "service unavailable", "overloaded_error"],
    errorClass: "http_5xx",
    providerMessage: "Upstream Provider Server Error (5xx)",
    clientMessage: GLOBAL_DEFAULT_ERROR.clientMessage,
  },
  {
    id: "empty_stream_or_network",
    matchPatterns: [
      "ended without any event",
      "empty response body",
      "fetch failed",
      "econnrefused",
      "econnreset",
      "socket hang up",
      "network error",
    ],
    errorClass: "network",
    providerMessage: "Upstream Network / Empty Stream Error",
    clientMessage: "Koneksi ke server model terputus. Silakan coba lagi beberapa saat.",
  },
];

function matchesStatus(ruleStatus: number | number[] | undefined, actualStatus: number | null): boolean {
  if (ruleStatus === undefined || actualStatus === null) return false;
  return Array.isArray(ruleStatus) ? ruleStatus.includes(actualStatus) : ruleStatus === actualStatus;
}

function matchesPattern(patterns: string[] | undefined, textLower: string): boolean {
  if (!patterns || patterns.length === 0 || !textLower) return false;
  return patterns.some((p) => textLower.includes(p.toLowerCase()));
}

/**
 * Resolves an upstream HTTP/stream error into a standardized MappedErrorResult using ERROR_MAPPING_RULES.
 * Never returns raw upstream text directly; falls back to GLOBAL_DEFAULT_ERROR when no rule matches.
 */
export function mapProviderError(options: {
  httpStatus?: number | null;
  rawText?: string | null;
  timedOut?: boolean;
  clientAborted?: boolean;
  fallbackErrorClass?: RoutingErrorClass;
}): MappedErrorResult {
  const status = options.httpStatus ?? null;
  const textLower = (options.rawText ?? "").trim().toLowerCase();

  if (options.clientAborted) {
    const abortRule = ERROR_MAPPING_RULES.find((r) => r.id === "client_aborted");
    if (abortRule) {
      return {
        ruleId: abortRule.id,
        errorClass: abortRule.errorClass,
        providerMessage: abortRule.providerMessage,
        clientMessage: abortRule.clientMessage,
      };
    }
  }

  if (options.timedOut) {
    const timeoutRule = ERROR_MAPPING_RULES.find((r) => r.id === "upstream_timeout");
    if (timeoutRule) {
      return {
        ruleId: timeoutRule.id,
        errorClass: timeoutRule.errorClass,
        providerMessage: timeoutRule.providerMessage,
        clientMessage: timeoutRule.clientMessage,
      };
    }
  }

  // Pass 1: Match specific pattern rules (or status + pattern when requireBothStatusAndPattern is set)
  for (const rule of ERROR_MAPPING_RULES) {
    const hasStatus = rule.httpStatus !== undefined;
    const hasPatterns = Boolean(rule.matchPatterns && rule.matchPatterns.length > 0);
    const statusOk = matchesStatus(rule.httpStatus, status);
    const patternOk = matchesPattern(rule.matchPatterns, textLower);

    if (rule.requireBothStatusAndPattern) {
      if (statusOk && patternOk) {
        return {
          ruleId: rule.id,
          errorClass: rule.errorClass,
          providerMessage: rule.providerMessage,
          clientMessage: rule.clientMessage,
        };
      }
      continue;
    }

    if (hasPatterns && patternOk) {
      return {
        ruleId: rule.id,
        errorClass: rule.errorClass,
        providerMessage: rule.providerMessage,
        clientMessage: rule.clientMessage,
      };
    }

    if (hasStatus && !hasPatterns && statusOk) {
      return {
        ruleId: rule.id,
        errorClass: rule.errorClass,
        providerMessage: rule.providerMessage,
        clientMessage: rule.clientMessage,
      };
    }
  }

  // Pass 2: Match by HTTP status code alone if pattern didn't match
  if (status !== null) {
    for (const rule of ERROR_MAPPING_RULES) {
      if (!rule.requireBothStatusAndPattern && matchesStatus(rule.httpStatus, status)) {
        return {
          ruleId: rule.id,
          errorClass: rule.errorClass,
          providerMessage: rule.providerMessage,
          clientMessage: rule.clientMessage,
        };
      }
    }
  }

  // Fallback to global default error
  const inferredClass: RoutingErrorClass =
    options.fallbackErrorClass ??
    (status !== null
      ? status === 404
        ? "model_not_found"
        : status === 401 || status === 403
          ? "auth"
          : status === 429
            ? "rate_limited"
            : status === 408 || status === 504
              ? "timeout"
              : status >= 500
                ? "http_5xx"
                : status >= 400
                  ? "bad_request"
                  : "unknown"
      : "unknown");

  return {
    ruleId: GLOBAL_DEFAULT_ERROR.ruleId,
    errorClass: inferredClass,
    providerMessage:
      status !== null
        ? `${GLOBAL_DEFAULT_ERROR.providerMessage} (HTTP ${status})`
        : GLOBAL_DEFAULT_ERROR.providerMessage,
    clientMessage: GLOBAL_DEFAULT_ERROR.clientMessage,
  };
}
