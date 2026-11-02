/** Client-safe quota types shared by the API (429 `details.quota`) and the chat UI. */

export type QuotaKind =
  | "monthly_cost"
  | "weekly_cost"
  | "five_hour_cost"
  | "daily_requests"
  | "rate_per_minute";

export interface QuotaNotice {
  kind: QuotaKind;
  /** USD for the *_cost kinds, a request count otherwise */
  used: number;
  limit: number;
  /** ISO timestamp when this limit frees up again */
  resetAt: string;
}

/**
 * Extracts a quota notice from a failed chat request. The AI SDK transport throws
 * the raw response body as the error message, so it is parsed as our JSON error.
 */
export function parseQuotaError(err: unknown): QuotaNotice | null {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (!raw.trim().startsWith("{")) return null;
  try {
    const body = JSON.parse(raw) as {
      error?: { code?: string; details?: { quota?: QuotaNotice } };
    };
    const quota = body.error?.details?.quota;
    return body.error?.code === "RATE_LIMITED" && quota?.kind && quota.resetAt ? quota : null;
  } catch {
    return null;
  }
}

/** Human-readable message from a failed request, unwrapping our JSON error body. */
export function readableErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : "";
  if (!raw) return fallback;
  try {
    const body = JSON.parse(raw) as { error?: { message?: string } };
    return body.error?.message?.trim() || fallback;
  } catch {
    return raw;
  }
}
