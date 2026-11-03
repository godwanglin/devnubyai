import {
  ANTIGRAVITY_IDE_VERSION,
  ANTIGRAVITY_QUOTA_URL,
  ANTIGRAVITY_USER_AGENT,
} from "../constants/antigravity";
import type { ProviderQuotaResult, QuotaItem } from "./grok-cli";

const GROUP_CONFIGS = [
  {
    pattern: /gemini/i,
    weekly: { key: "gemini_weekly", displayName: "Gemini (Weekly)" },
    session: { key: "gemini_session", displayName: "Gemini (5h)" },
  },
  {
    pattern: /claude|gpt/i,
    weekly: { key: "claude_gpt_weekly", displayName: "Claude & GPT (Weekly)" },
    session: { key: "claude_gpt_session", displayName: "Claude & GPT (5h)" },
  },
];

/** Quota key prefix of the family a model draws from ("gemini_*" or "claude_gpt_*"). */
export function antigravityQuotaFamily(model: string): "gemini_" | "claude_gpt_" | null {
  if (/gemini/i.test(model)) return "gemini_";
  if (/claude|gpt/i.test(model)) return "claude_gpt_";
  return null;
}

/** True when a quota window belongs to another model family than the requested model. */
export function isOtherAntigravityFamily(quotaKey: string, model: string | undefined): boolean {
  if (!model || !(quotaKey.startsWith("gemini_") || quotaKey.startsWith("claude_gpt_"))) return false;
  const family = antigravityQuotaFamily(model);
  return family !== null && !quotaKey.startsWith(family);
}

function parseResetTime(value: unknown): string | null {
  if (!value) return null;
  try {
    const d = new Date(String(value));
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  } catch {
    return null;
  }
}

export function parseAntigravityQuotaSummary(data: unknown): Record<string, QuotaItem> {
  if (!data || typeof data !== "object") return {};
  const root = data as Record<string, unknown>;

  const groups = Array.isArray(root.groups)
    ? (root.groups as Array<Record<string, unknown>>)
    : Array.isArray((root.quotaSummary as Record<string, unknown>)?.groups)
      ? ((root.quotaSummary as Record<string, unknown>).groups as Array<Record<string, unknown>>)
      : null;

  if (!groups) return {};

  const result: Record<string, QuotaItem> = {};

  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const displayName = typeof group.displayName === "string" ? group.displayName : "";
    const buckets = Array.isArray(group.buckets) ? (group.buckets as Array<Record<string, unknown>>) : [];

    for (const bucket of buckets) {
      if (!bucket || typeof bucket !== "object") continue;
      const windowType = String(bucket.window || "").toLowerCase();
      const bucketText = `${bucket.bucketId || ""} ${bucket.displayName || ""}`.toLowerCase();
      const isWeekly = windowType === "weekly" || bucketText.includes("weekly");
      const isSession =
        windowType === "5h" ||
        bucketText.includes("five hour") ||
        bucketText.includes("5h") ||
        bucketText.includes("daily") ||
        windowType === "daily";

      if (!isWeekly && !isSession) continue;
      if (bucket.disabled === true && isWeekly) continue;

      const remainingFraction = bucket.disabled === true ? 0 : Number(bucket.remainingFraction);
      if (!Number.isFinite(remainingFraction)) continue;

      for (const config of GROUP_CONFIGS) {
        if (config.pattern.test(displayName)) {
          const target = isWeekly ? config.weekly : config.session;
          if (result[target.key]) break;

          const total = 100;
          const remainingPercentage = Math.max(0, Math.min(100, remainingFraction * 100));
          const used = Math.max(0, 100 - remainingPercentage);

          result[target.key] = {
            used,
            total,
            resetAt: parseResetTime(bucket.resetTime),
            remainingPercentage,
            unlimited: false,
          };
          break;
        }
      }
    }
  }

  return result;
}

export async function fetchAntigravityQuota(
  accessToken: string,
  providerData: Record<string, unknown> | null
): Promise<ProviderQuotaResult> {
  const projectId =
    typeof providerData?.projectId === "string" && providerData.projectId.trim()
      ? providerData.projectId.trim()
      : undefined;

  try {
    const res = await fetch(ANTIGRAVITY_QUOTA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_USER_AGENT,
        "Content-Type": "application/json",
        "X-Client-Name": "antigravity",
        "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
      },
      body: JSON.stringify({
        ...(projectId ? { project: projectId } : {}),
      }),
    });

    if (!res.ok) {
      return {
        supported: true,
        quotas: {},
        exhausted: false,
        message: `Quota summary unavailable (HTTP ${res.status})`,
      };
    }

    const data = (await res.json().catch(() => ({}))) as unknown;
    const quotas = parseAntigravityQuotaSummary(data);
    const windows = Object.values(quotas);

    // Buckets are per model family: the account is only fully exhausted when every one is.
    // Per-family blocking is handled by isConnectionQuotaExhausted(conn, now, model).
    const exhausted = windows.length > 0 && windows.every((q) => q.remainingPercentage <= 0);
    const periodEnd = exhausted
      ? windows.reduce<string | null>((min, q) => (q.resetAt && (!min || q.resetAt < min) ? q.resetAt : min), null)
      : null;

    return {
      supported: true,
      plan: "Cloud Code Assist",
      quotas,
      periodEnd,
      exhausted,
    };
  } catch (err) {
    return {
      supported: true,
      quotas: {},
      exhausted: false,
      message: err instanceof Error ? err.message : "Gagal memuat kuota",
    };
  }
}
