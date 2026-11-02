import {
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_USER_AGENT,
  GROK_CLI_VERSION,
} from "../constants/grok-cli";
import { decodeGrokCreditsFrame } from "./grok-frame";

export interface QuotaItem {
  used: number;
  total: number;
  remainingPercentage: number;
  resetAt: string | null;
  unlimited: boolean;
}

export interface ProviderQuotaResult {
  supported: boolean;
  plan?: string | null;
  quotas: Record<string, QuotaItem>;
  periodEnd?: string | null;
  exhausted: boolean;
  subscriptionAccess?: boolean;
  message?: string;
  /** OpenAI/Codex only: rate-limit reset credits the account can still redeem */
  resetCreditsAvailable?: number;
}

const BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const USER_URL = "https://cli-chat-proxy.grok.com/v1/user?include=subscription";
const GRPC_CREDITS_URL = "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig";
const GRPC_WEB_EMPTY_REQUEST_FRAME = Buffer.from([0, 0, 0, 0, 0]);

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function parseResetTime(resetValue: unknown): string | null {
  if (!resetValue) return null;
  try {
    if (resetValue instanceof Date) return resetValue.toISOString();
    if (typeof resetValue === "number") {
      return new Date(resetValue < 1e12 ? resetValue * 1000 : resetValue).toISOString();
    }
    if (typeof resetValue === "string") {
      if (/^\d+$/.test(resetValue)) {
        const timestamp = Number(resetValue);
        return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).toISOString();
      }
      return new Date(resetValue).toISOString();
    }
    return null;
  } catch {
    return null;
  }
}

function unwrapVal(value: unknown, fallback = 0): number {
  if (value == null) return fallback;
  if (typeof value === "object" && !Array.isArray(value) && "val" in (value as Record<string, unknown>)) {
    return toFiniteNumber((value as Record<string, unknown>).val, fallback);
  }
  return toFiniteNumber(value, fallback);
}

function planFromAccessToken(accessToken: string): string {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));
    const tiers: Record<number, string> = {
      0: "Free",
      1: "SuperGrok",
      2: "X Basic",
      3: "X Premium",
      4: "X Premium Plus",
      5: "SuperGrok Heavy",
      6: "SuperGrok Lite",
    };
    return tiers[payload.tier as number] || "";
  } catch {
    return "";
  }
}

function makeQuota({
  used,
  total,
  resetAt,
  unlimited = false,
}: {
  used: number;
  total: number;
  resetAt?: string | null;
  unlimited?: boolean;
}): QuotaItem {
  const safeTotal = Math.max(0, toFiniteNumber(total, 0));
  const safeUsed = Math.max(0, toFiniteNumber(used, 0));
  if (unlimited || safeTotal === 0) {
    return {
      used: safeUsed,
      total: 0,
      remainingPercentage: unlimited ? 100 : 0,
      resetAt: resetAt || null,
      unlimited: true,
    };
  }
  const remaining = Math.max(0, safeTotal - safeUsed);
  const remainingPercentage = (remaining / safeTotal) * 100;
  return {
    used: safeUsed,
    total: safeTotal,
    remainingPercentage,
    resetAt: resetAt || null,
    unlimited: false,
  };
}

export async function fetchGrokCliQuota(
  accessToken: string,
  providerData?: Record<string, unknown> | null
): Promise<ProviderQuotaResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": GROK_CLI_USER_AGENT,
    "x-xai-token-auth": "xai-grok-cli",
    "x-grok-client-identifier": GROK_CLI_CLIENT_IDENTIFIER,
    "x-grok-client-version": GROK_CLI_VERSION,
    "x-grok-client-mode": "headless",
  };

  const email = (providerData?.email as string) || undefined;
  const userId = ((providerData?.userId || providerData?.principalId) as string) || undefined;
  if (email) headers["x-email"] = email;
  if (userId) headers["x-userid"] = userId;

  try {
    const [billingRes, userRes] = await Promise.all([
      fetch(BILLING_URL, { method: "GET", headers }),
      fetch(USER_URL, { method: "GET", headers }).catch(() => null),
    ]);

    if (billingRes.status === 401 || billingRes.status === 403) {
      return {
        supported: true,
        exhausted: true,
        quotas: {},
        message: "Authentication expired. Please re-authorize.",
      };
    }

    if (!billingRes.ok) {
      return {
        supported: true,
        exhausted: false,
        quotas: {},
        message: `Billing error HTTP ${billingRes.status}`,
      };
    }

    const billing = (await billingRes.json().catch(() => ({}))) as Record<string, unknown>;
    const user = userRes?.ok ? ((await userRes.json().catch(() => ({}))) as Record<string, unknown>) : null;

    const root = billing && typeof billing === "object" ? billing : {};
    const config = (root.config && typeof root.config === "object" ? root.config : root) as Record<string, unknown>;

    const periodEnd =
      parseResetTime(config.billingPeriodEnd) ||
      parseResetTime(config.billing_period_end) ||
      parseResetTime((config.currentPeriod as Record<string, unknown>)?.end) ||
      parseResetTime(config.resetAt || config.resetsAt || config.periodEnd) ||
      null;

    const quotas: Record<string, QuotaItem> = {};
    const rawTier = String(user?.subscriptionTier ?? config?.subscriptionTier ?? "");
    const subscriptionAccess = Boolean(rawTier) && !/^(free|none|null)$/i.test(rawTier);

    // Monthly included
    const monthlyLimit = unwrapVal(config.monthlyLimit ?? config.monthly_limit, NaN);
    const includedUsed = unwrapVal(config.includedUsed ?? config.included_used, NaN);
    const totalUsed = unwrapVal(config.totalUsed ?? config.total_used, NaN);
    if (Number.isFinite(monthlyLimit) && monthlyLimit > 0) {
      quotas["Monthly included"] = makeQuota({
        used: Number.isFinite(includedUsed) ? includedUsed : Number.isFinite(totalUsed) ? totalUsed : 0,
        total: monthlyLimit,
        resetAt: periodEnd,
      });
    }

    // On-demand cap
    const onDemandCap = unwrapVal(config.onDemandCap, NaN);
    const onDemandUsed = unwrapVal(config.onDemandUsed, NaN);
    if (Number.isFinite(onDemandCap) && onDemandCap > 0) {
      quotas["On-demand"] = makeQuota({
        used: Number.isFinite(onDemandUsed) ? Math.max(0, onDemandUsed) : 0,
        total: onDemandCap,
        resetAt: periodEnd,
      });
    } else if (!subscriptionAccess && Number.isFinite(onDemandCap) && onDemandCap === 0) {
      // Depleted free tier
      quotas["On-demand"] = {
        used: 1,
        total: 1,
        remainingPercentage: 0,
        resetAt: periodEnd,
        unlimited: false,
      };
    }

    // Prepaid balance
    const prepaid = unwrapVal(config.prepaidBalance, NaN);
    if (Number.isFinite(prepaid) && prepaid > 0) {
      quotas["Prepaid"] = {
        used: 0,
        total: prepaid,
        remainingPercentage: 100,
        resetAt: null,
        unlimited: false,
      };
    }

    // SuperGrok weekly shared pool
    const usedPct = unwrapVal(config.creditUsagePercent ?? config.credit_usage_percent, NaN);
    if (Number.isFinite(usedPct) && usedPct >= 0) {
      quotas["Weekly SuperGrok"] = makeQuota({
        used: Math.max(0, Math.min(100, usedPct)),
        total: 100,
        resetAt: periodEnd,
      });
    }

    // If no quota returned yet, try gRPC-web GetGrokCreditsConfig
    if (Object.keys(quotas).length === 0) {
      try {
        const grpcRes = await fetch(GRPC_CREDITS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/grpc-web+proto",
            "X-Grpc-Web": "1",
            Accept: "application/grpc-web+proto",
          },
          body: GRPC_WEB_EMPTY_REQUEST_FRAME,
        });
        if (grpcRes.ok) {
          const ab = await grpcRes.arrayBuffer();
          const decoded = decodeGrokCreditsFrame(Buffer.from(ab));
          if (decoded && Number.isFinite(decoded.percentUsed)) {
            const used = Math.round(Math.max(0, Math.min(100, decoded.percentUsed)));
            quotas["Weekly SuperGrok"] = makeQuota({
              used,
              total: 100,
              resetAt: decoded.resetAt,
            });
          }
        }
      } catch {
        // fail-open
      }
    }

    const plan = planFromAccessToken(accessToken) || (rawTier ? rawTier.replace(/[_-]+/g, " ") : "Grok Build");
    const exhausted =
      Object.keys(quotas).length > 0 &&
      Object.values(quotas).every((q) => !q.unlimited && q.remainingPercentage <= 0);

    return {
      supported: true,
      plan,
      quotas,
      periodEnd,
      exhausted,
      subscriptionAccess,
    };
  } catch (err: unknown) {
    return {
      supported: true,
      exhausted: false,
      quotas: {},
      message: err instanceof Error ? err.message : "Failed to fetch Grok CLI quota",
    };
  }
}
