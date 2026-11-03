import {
  CLAUDE_API_VERSION,
  CLAUDE_OAUTH_USAGE_URL,
  CLAUDE_PROFILE_URL,
  CLAUDE_RESET_RATE_LIMITS_URL,
  CLAUDE_RESET_USER_AGENT,
  CLAUDE_SETTINGS_URL,
  CLAUDE_ORG_USAGE_URL,
} from "../constants/claude";
import type { ProviderQuotaResult, QuotaItem } from "./grok-cli";
import type {
  ConsumeCreditResult,
  ResetCreditEntry,
  ResetCreditsAvailabilityResult,
} from "./openai";

export interface ClaudeGrantItem {
  id: string;
  label: string;
  resetsLeft: number;
  resetsTotal: number;
  startsAt: string | null;
  endsAt: string | null;
  clears: string[];
  paused: boolean;
  usableNow: boolean;
}

export interface ClaudeResetGrantsResult {
  availableCount: number;
  nextGrantId: string | null;
  expiresAt: string | null;
  clears: string[];
  cooldownUntil: string | null;
  weeklyResetsAt: string | null;
  grants: ClaudeGrantItem[];
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

/** Parses cedar_ember free limit reset grants block from Anthropic. */
export function parseClaudeResetGrants(block: unknown): ClaudeResetGrantsResult | null {
  if (!block || typeof block !== "object") return null;
  const b = block as Record<string, unknown>;
  if (!b.eligible || !Array.isArray(b.grants)) return null;

  const rawGrants = b.grants as Array<Record<string, unknown>>;
  const activeGrants = rawGrants.filter(
    (g) => g && typeof g.id === "string" && !g.paused && toFiniteNumber(g.resets_left, 0) > 0
  );

  const nextGrantId = typeof b.next_grant_id === "string" ? b.next_grant_id : null;
  const next = activeGrants.find((g) => g.id === nextGrantId) || activeGrants[0] || null;

  const mappedGrants: ClaudeGrantItem[] = rawGrants
    .filter((g) => g && typeof g.id === "string")
    .map((g) => ({
      id: String(g.id),
      label: typeof g.label === "string" ? g.label : "Claude limit reset",
      resetsLeft: toFiniteNumber(g.resets_left, 0),
      resetsTotal: toFiniteNumber(g.resets_total, 0),
      startsAt: toIsoDate(g.starts_at),
      endsAt: toIsoDate(g.ends_at),
      clears: Array.isArray(g.clears) ? (g.clears as string[]) : [],
      paused: g.paused === true,
      usableNow: g.usable_now === true,
    }));

  const totalAvailable = mappedGrants
    .filter((g) => !g.paused)
    .reduce((sum, g) => sum + g.resetsLeft, 0);

  return {
    availableCount: totalAvailable,
    nextGrantId: next ? String(next.id) : null,
    expiresAt: next ? toIsoDate(next.ends_at) : null,
    clears: next && Array.isArray(next.clears) ? (next.clears as string[]) : [],
    cooldownUntil: toIsoDate(b.cooldown_until),
    weeklyResetsAt: toIsoDate(b.weekly_resets_at),
    grants: mappedGrants,
  };
}

function createQuotaObject(window: unknown): QuotaItem | null {
  if (!window || typeof window !== "object") return null;
  const w = window as Record<string, unknown>;
  if (typeof w.utilization !== "number" && typeof w.percent !== "number") return null;

  const used = Math.max(0, Math.min(100, toFiniteNumber(w.utilization ?? w.percent, 0)));
  const remaining = Math.max(0, 100 - used);
  return {
    used,
    total: 100,
    remainingPercentage: remaining,
    resetAt: toIsoDate(w.resets_at ?? w.reset_at),
    unlimited: false,
  };
}

function buildClaudeHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "anthropic-beta": "oauth-2025-04-20",
    "anthropic-version": CLAUDE_API_VERSION,
    "User-Agent": CLAUDE_RESET_USER_AGENT,
    Accept: "application/json",
  };
}

/** Fetches usage windows (5h, 7d, model-specific) & cedar_ember reset grants. */
export async function fetchClaudeQuota(
  accessToken: string,
  _providerData?: Record<string, unknown> | null
): Promise<ProviderQuotaResult> {
  try {
    const res = await fetch(`${CLAUDE_OAUTH_USAGE_URL}?cedar_ember=1`, {
      method: "GET",
      headers: buildClaudeHeaders(accessToken),
    });

    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const quotas: Record<string, QuotaItem> = {};

      const session = createQuotaObject(data.five_hour);
      if (session) quotas["session (5h)"] = session;

      const weekly = createQuotaObject(data.seven_day);
      if (weekly) quotas["weekly (7d)"] = weekly;

      // Model-specific weekly windows (e.g. seven_day_sonnet, seven_day_opus)
      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith("seven_day_") && key !== "seven_day") {
          const modelName = key.replace("seven_day_", "");
          const q = createQuotaObject(value);
          if (q) quotas[`weekly ${modelName} (7d)`] = q;
        }
      }

      // Model-scoped weekly limits (e.g. Fable)
      if (Array.isArray(data.limits)) {
        for (const limit of data.limits as Array<Record<string, unknown>>) {
          if (limit?.kind !== "weekly_scoped") continue;
          const scope = limit.scope as Record<string, unknown> | undefined;
          const modelObj = scope?.model as Record<string, unknown> | undefined;
          const modelName = String(modelObj?.display_name || "").trim().toLowerCase();
          if (!modelName) continue;
          const q = createQuotaObject(limit);
          if (q) quotas[`weekly ${modelName} (7d)`] = q;
        }
      }

      const resetGrants = parseClaudeResetGrants(data.cedar_ember);
      const isExhausted =
        (session ? session.remainingPercentage <= 0 : false) ||
        (weekly ? weekly.remainingPercentage <= 0 : false);

      return {
        supported: true,
        plan: "Claude Code",
        quotas,
        periodEnd: weekly?.resetAt ?? session?.resetAt ?? null,
        exhausted: isExhausted,
        resetCreditsAvailable: resetGrants?.availableCount ?? 0,
      };
    }

    // Fallback: settings endpoint
    return await fetchClaudeQuotaFallback(accessToken);
  } catch (err: unknown) {
    return {
      supported: true,
      quotas: {},
      exhausted: false,
      message: err instanceof Error ? err.message : "Gagal memuat kuota Claude",
    };
  }
}

/** Fallback to Claude settings/org usage for legacy or non-cedar tokens. */
async function fetchClaudeQuotaFallback(accessToken: string): Promise<ProviderQuotaResult> {
  try {
    const res = await fetch(CLAUDE_SETTINGS_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-version": CLAUDE_API_VERSION,
        Accept: "application/json",
      },
    });

    if (res.ok) {
      const settings = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const plan = typeof settings.plan === "string" ? settings.plan : "Claude";
      const orgId = typeof settings.organization_id === "string" ? settings.organization_id : null;

      if (orgId) {
        const usageRes = await fetch(CLAUDE_ORG_USAGE_URL.replace("{org_id}", orgId), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "anthropic-version": CLAUDE_API_VERSION,
            Accept: "application/json",
          },
        });
        if (usageRes.ok) {
          const usage = (await usageRes.json().catch(() => ({}))) as Record<string, unknown>;
          const quotas: Record<string, QuotaItem> = {};
          if (usage.five_hour) {
            const q = createQuotaObject(usage.five_hour);
            if (q) quotas["session (5h)"] = q;
          }
          if (usage.seven_day) {
            const q = createQuotaObject(usage.seven_day);
            if (q) quotas["weekly (7d)"] = q;
          }
          return {
            supported: true,
            plan,
            quotas,
            exhausted: false,
          };
        }
      }

      return {
        supported: true,
        plan,
        quotas: {},
        exhausted: false,
      };
    }

    return {
      supported: true,
      quotas: {},
      exhausted: false,
      message: `Claude usage unavailable (HTTP ${res.status})`,
    };
  } catch (err: unknown) {
    return {
      supported: true,
      quotas: {},
      exhausted: false,
      message: err instanceof Error ? err.message : "Gagal memuat kuota Claude",
    };
  }
}

/** Fetches available Claude reset grants, returning shape compatible with ResetCreditsAvailabilityResult. */
export async function fetchClaudeResetGrants(
  accessToken: string,
  _providerData?: Record<string, unknown> | null
): Promise<ResetCreditsAvailabilityResult & { rawGrants?: ClaudeGrantItem[] }> {
  const res = await fetch(`${CLAUDE_OAUTH_USAGE_URL}?cedar_ember=1`, {
    method: "GET",
    headers: buildClaudeHeaders(accessToken),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Failed to fetch Claude reset grants (HTTP ${res.status}): ${errText}`);
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseClaudeResetGrants(data.cedar_ember);

  if (!parsed || parsed.grants.length === 0) {
    return { availableCount: 0, credits: [] };
  }

  const credits: ResetCreditEntry[] = parsed.grants.map((g) => ({
    status: g.paused ? "paused" : g.resetsLeft > 0 ? "available" : "used",
    grantedAt: g.startsAt,
    expiresAt: g.endsAt,
  }));

  return {
    availableCount: parsed.availableCount,
    credits,
    rawGrants: parsed.grants,
  };
}

/** Consumes 1 Claude cedar_ember limit reset grant. */
export async function consumeClaudeResetCredit(
  accessToken: string,
  grantId?: string | null,
  providerData?: Record<string, unknown> | null
): Promise<ConsumeCreditResult> {
  const headers = {
    ...buildClaudeHeaders(accessToken),
    "Content-Type": "application/json",
  };

  // Determine orgId
  let orgId = typeof providerData?.orgId === "string" ? providerData.orgId : null;
  if (!orgId) {
    const profileRes = await fetch(CLAUDE_PROFILE_URL, {
      method: "GET",
      headers,
    });
    const profile = (await profileRes.json().catch(() => ({}))) as Record<string, unknown>;
    const org = (profile.organization && typeof profile.organization === "object" ? profile.organization : {}) as Record<string, unknown>;
    orgId = typeof org.uuid === "string" ? org.uuid : null;
  }

  if (!orgId) {
    throw new Error("Cannot resolve Claude organization ID for limit reset");
  }

  // If grantId is not provided, fetch current usage to resolve the next available grant
  let targetGrantId = grantId;
  if (!targetGrantId) {
    const usageRes = await fetch(`${CLAUDE_OAUTH_USAGE_URL}?cedar_ember=1`, {
      method: "GET",
      headers,
    });
    if (usageRes.ok) {
      const usage = (await usageRes.json().catch(() => ({}))) as Record<string, unknown>;
      const parsed = parseClaudeResetGrants(usage.cedar_ember);
      targetGrantId = parsed?.nextGrantId || parsed?.grants[0]?.id || null;
    }
  }

  if (!targetGrantId) {
    return {
      ok: false,
      noCredit: true,
      status: 400,
      code: "no_grant_available",
      windowsReset: 0,
      message: "No Claude reset grants available for this account",
    };
  }

  const resetUrl = CLAUDE_RESET_RATE_LIMITS_URL.replace("{org_id}", orgId);
  const res = await fetch(resetUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      program: "cedar_ember",
      grant_id: targetGrantId,
      request_id: crypto.randomUUID(),
    }),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const ok = res.ok && data?.result === "reset";
  const noCredit = res.status === 400 && data?.reason === "no_grants_left";
  const errObj = data?.error as Record<string, unknown> | undefined;
  const message = (typeof errObj?.message === "string" && errObj.message) || (typeof data?.reason === "string" ? data.reason : null);

  return {
    ok,
    noCredit,
    status: res.status,
    code: (typeof data?.result === "string" && data.result) || (typeof data?.reason === "string" ? data.reason : null),
    windowsReset: ok ? 1 : 0,
    message: ok ? "Claude rate limits successfully reset" : message || `Reset not applied (HTTP ${res.status})`,
    raw: data,
  };
}
