import type { OAuthProviderId } from "../providers";
import { fetchGrokCliQuota, type ProviderQuotaResult } from "./grok-cli";
import { fetchOpenAiQuota } from "./openai";
import { fetchAntigravityQuota } from "./antigravity";

export type { ProviderQuotaResult, QuotaItem } from "./grok-cli";

/** Per-provider quota fetchers; providers without one report `supported: false`. */
const QUOTA_FETCHERS: Partial<
  Record<OAuthProviderId, (accessToken: string, providerData: Record<string, unknown> | null) => Promise<ProviderQuotaResult>>
> = {
  "grok-cli": fetchGrokCliQuota,
  openai: fetchOpenAiQuota,
  antigravity: fetchAntigravityQuota,
};

export function isQuotaSupported(provider: OAuthProviderId): boolean {
  return Boolean(QUOTA_FETCHERS[provider]);
}

export async function fetchProviderQuota(
  provider: OAuthProviderId,
  accessToken: string,
  providerData: Record<string, unknown> | null
): Promise<ProviderQuotaResult> {
  const fetcher = QUOTA_FETCHERS[provider];
  if (!fetcher) return { supported: false, quotas: {}, exhausted: false };
  return fetcher(accessToken, providerData);
}
