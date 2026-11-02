import {
  CODEX_RESET_CREDITS_CONSUME_URL,
  CODEX_RESET_CREDITS_HISTORY_URL,
  CODEX_RESET_CREDITS_URL,
  CODEX_USAGE_URL,
} from "../constants/openai";
import type { ProviderQuotaResult, QuotaItem } from "./grok-cli";

export interface ResetCreditEntry {
  status: string;
  grantedAt: string | null;
  expiresAt: string | null;
}

export interface ResetCreditsAvailabilityResult {
  availableCount: number;
  credits: ResetCreditEntry[];
}

export interface ResetCreditHistoryItem {
  /** Event id, e.g. "RateLimitResetCredit_<hash>:granted" */
  id: string;
  /** Credit id without the ":kind" suffix, links the granted and used events of one credit */
  creditId: string | null;
  /** "granted" | "used" | other upstream kinds */
  kind: string;
  occurredAt: string | null;
  raw: Record<string, unknown>;
}

export interface ResetCreditsHistoryResult {
  items: ResetCreditHistoryItem[];
  windowStart: string | null;
  asOf: string | null;
  nextCursor: string | null;
}

export interface ConsumeCreditResult {
  ok: boolean;
  noCredit: boolean;
  status: number;
  code: string | null;
  windowsReset: number;
  message: string | null;
  raw?: unknown;
}

/** Upstream ChatGPT error that keeps the HTTP status, so callers retry only on 401. */
export class CodexUpstreamError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "CodexUpstreamError";
  }
}

function upstreamErrorMessage(data: unknown, status: number): string {
  const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const err = obj.error;
  const text =
    (err && typeof err === "object" ? (err as { message?: string }).message : err) ||
    obj.message ||
    obj.detail ||
    `HTTP ${status}`;
  return String(text);
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  try {
    const d =
      value instanceof Date
        ? value
        : new Date(typeof value === "number" && value < 1e12 ? value * 1000 : String(value));
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  } catch {
    return null;
  }
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function formatWindow(window: Record<string, unknown> | null | undefined): QuotaItem | null {
  if (!window) return null;
  const used = Math.max(
    0,
    Math.min(100, toFiniteNumber(window.used_percent ?? window.percent_used, 0))
  );
  return {
    used,
    total: 100,
    remainingPercentage: Math.max(0, 100 - used),
    resetAt: toIsoDate(window.reset_at ?? window.resets_at ?? window.resetAt),
    unlimited: false,
  };
}

function buildHeaders(accessToken: string, providerData?: Record<string, unknown> | null): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    originator: "codex_cli_rs",
  };
  const accountId =
    (typeof providerData?.chatgptAccountId === "string" && providerData.chatgptAccountId) ||
    (typeof providerData?.workspaceId === "string" && providerData.workspaceId) ||
    (typeof providerData?.accountId === "string" && providerData.accountId);
  if (accountId) headers["ChatGPT-Account-ID"] = accountId;
  return headers;
}

/** Fetches usage windows (session & weekly) + available reset credits count. */
export async function fetchOpenAiQuota(
  accessToken: string,
  providerData: Record<string, unknown> | null
): Promise<ProviderQuotaResult> {
  try {
    const res = await fetch(CODEX_USAGE_URL, {
      method: "GET",
      headers: buildHeaders(accessToken, providerData),
    });

    if (!res.ok) {
      return {
        supported: true,
        quotas: {},
        exhausted: false,
        message: `Codex usage unavailable (HTTP ${res.status})`,
      };
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const rateLimit =
      (data.rate_limit && typeof data.rate_limit === "object" ? (data.rate_limit as Record<string, unknown>) : null) ??
      data;

    const primary = formatWindow(rateLimit.primary_window as Record<string, unknown> | undefined);
    const secondary = formatWindow(rateLimit.secondary_window as Record<string, unknown> | undefined);

    const quotas: Record<string, QuotaItem> = {};
    if (primary) quotas.session = primary;
    if (secondary) quotas.weekly = secondary;

    const availableResetCredits = toFiniteNumber(
      (data.rate_limit_reset_credits as Record<string, unknown> | undefined)?.available_count,
      0
    );

    const isExhausted =
      Boolean(rateLimit.limit_reached) ||
      (primary ? primary.remainingPercentage <= 0 : false) ||
      (secondary ? secondary.remainingPercentage <= 0 : false);

    const plan =
      (typeof data.plan_type === "string" && data.plan_type) ||
      (typeof providerData?.chatgptPlanType === "string" && providerData.chatgptPlanType) ||
      null;

    return {
      supported: true,
      plan,
      quotas,
      periodEnd: secondary?.resetAt ?? primary?.resetAt ?? null,
      exhausted: isExhausted,
      resetCreditsAvailable: availableResetCredits,
    };
  } catch (err: unknown) {
    return {
      supported: true,
      quotas: {},
      exhausted: false,
      message: err instanceof Error ? err.message : "Gagal memuat kuota",
    };
  }
}

/** Fetches available reset credits with grant and expiry timestamps. */
export async function fetchOpenAiResetCredits(
  accessToken: string,
  providerData?: Record<string, unknown> | null
): Promise<ResetCreditsAvailabilityResult> {
  const headers = {
    ...buildHeaders(accessToken, providerData),
    "OpenAI-Beta": "codex-1",
  };
  const res = await fetch(CODEX_RESET_CREDITS_URL, { method: "GET", headers });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) throw new CodexUpstreamError(res.status, upstreamErrorMessage(data, res.status));

  const rawCredits = Array.isArray(data.credits) ? data.credits : [];
  const credits: ResetCreditEntry[] = rawCredits.map((c: unknown) => {
    const it = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
    return {
      status: String(it.status || "unknown"),
      grantedAt: toIsoDate(it.granted_at ?? it.grantedAt),
      expiresAt: toIsoDate(it.expires_at ?? it.expiresAt),
    };
  });

  return {
    availableCount: Math.max(0, toFiniteNumber(data.available_count ?? data.availableCount, 0)),
    credits,
  };
}

/** Fetches the reset credits consumption history (https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/history). */
export async function fetchOpenAiResetCreditsHistory(
  accessToken: string,
  providerData?: Record<string, unknown> | null
): Promise<ResetCreditsHistoryResult> {
  const headers = {
    ...buildHeaders(accessToken, providerData),
    "OpenAI-Beta": "codex-1",
  };
  const res = await fetch(CODEX_RESET_CREDITS_HISTORY_URL, { method: "GET", headers });
  const data = (await res.json().catch(() => ({}))) as unknown;

  if (!res.ok) throw new CodexUpstreamError(res.status, upstreamErrorMessage(data, res.status));

  // Upstream shape: { events: [{ id, kind, occurred_at }], window_start, as_of, next_cursor }
  const root = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const list: unknown[] = Array.isArray(data) ? data : Array.isArray(root.events) ? root.events : [];

  const items: ResetCreditHistoryItem[] = list.map((entry, index) => {
    const it = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const id = it.id ? String(it.id) : `event-${index}`;
    const sep = id.lastIndexOf(":");
    const suffix = sep > 0 ? id.slice(sep + 1) : "";
    return {
      id,
      creditId: sep > 0 ? id.slice(0, sep) : null,
      kind: String(it.kind || suffix || "unknown"),
      occurredAt: toIsoDate(it.occurred_at ?? it.occurredAt),
      raw: it,
    };
  });

  // Newest first regardless of upstream order
  items.sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""));

  return {
    items,
    windowStart: toIsoDate(root.window_start),
    asOf: toIsoDate(root.as_of),
    nextCursor: typeof root.next_cursor === "string" && root.next_cursor ? root.next_cursor : null,
  };
}

/** Consumes 1 rate-limit reset credit (irreversible upstream action). */
export async function consumeOpenAiResetCredit(
  accessToken: string,
  redeemRequestId: string,
  providerData?: Record<string, unknown> | null
): Promise<ConsumeCreditResult> {
  const headers = {
    ...buildHeaders(accessToken, providerData),
    "Content-Type": "application/json",
  };
  const res = await fetch(CODEX_RESET_CREDITS_CONSUME_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ redeem_request_id: redeemRequestId }),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const code = (typeof data.code === "string" && data.code) || null;
  const windowsReset = toFiniteNumber(data.windows_reset, 0);
  const ok = res.ok && (code === "reset" || windowsReset > 0);
  const noCredit = res.ok && code === "no_credit";
  const message = res.ok ? (typeof data.message === "string" && data.message) || null : upstreamErrorMessage(data, res.status);

  return {
    ok,
    noCredit,
    status: res.status,
    code,
    windowsReset,
    message,
    raw: data,
  };
}
