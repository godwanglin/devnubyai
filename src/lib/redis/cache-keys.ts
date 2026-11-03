import { invalidateCacheKey } from "./client";

export const CACHE_KEYS = {
  plansPublic: () => "cache:plans:public",
  paymentMethodsActive: () => "cache:payments:methods:active",
  sharedChat: (token: string) => `cache:share:chat:${token.trim()}`,
  userQuota: (userId: string | bigint) => `cache:user:${userId.toString()}:quota`,
  systemPromptsAll: () => "cache:admin:system_prompts:all",
  systemPromptsActive: () => "cache:system_prompts:active",
  userMe: (userId: string | bigint) => `cache:user:${userId.toString()}:me`,
  userSessions: (userId: string | bigint) => `cache:user:${userId.toString()}:sessions`,
  openaiResetCredits: (connectionId: string | bigint) =>
    `cache:admin:provider_connection:${connectionId.toString()}:reset_credits`,
  openaiResetCreditsHistory: (connectionId: string | bigint) =>
    `cache:admin:provider_connection:${connectionId.toString()}:reset_credits_history`,
  providerResetCredits: (provider: string, connectionId: string | bigint) =>
    `cache:admin:provider_connection:${provider}:${connectionId.toString()}:reset_credits`,
  providerResetCreditsHistory: (provider: string, connectionId: string | bigint) =>
    `cache:admin:provider_connection:${provider}:${connectionId.toString()}:reset_credits_history`,
} as const;

export const CACHE_TTL = {
  PLANS: 3600, // 1 hour
  PAYMENT_METHODS: 3600, // 1 hour
  SHARED_CHAT: 1800, // 30 minutes
  USER_QUOTA: 60, // 1 minute
  SYSTEM_PROMPTS: 3600, // 1 hour
  USER_ME: 300, // 5 minutes
  USER_SESSIONS: 120, // 2 minutes
  OPENAI_RESET_CREDITS: 300, // 5 minutes, keeps the admin UI from spamming chatgpt.com
} as const;

/**
 * Invalidate public plans list cache
 */
export async function invalidatePlansCache(): Promise<void> {
  await invalidateCacheKey(CACHE_KEYS.plansPublic());
}

/**
 * Invalidate payment methods cache
 */
export async function invalidatePaymentMethodsCache(): Promise<void> {
  await invalidateCacheKey(CACHE_KEYS.paymentMethodsActive());
}

/**
 * Invalidate public shared chat snapshot cache
 */
export async function invalidateSharedChatCache(token?: string | null): Promise<void> {
  if (!token) return;
  await invalidateCacheKey(CACHE_KEYS.sharedChat(token));
}

/**
 * Invalidate user token quota & windows cache
 */
export async function invalidateUserQuotaCache(userId: string | bigint): Promise<void> {
  await invalidateCacheKey(CACHE_KEYS.userQuota(userId));
}

/**
 * Invalidate admin and active system prompts cache
 */
export async function invalidateSystemPromptsCache(): Promise<void> {
  await Promise.allSettled([
    invalidateCacheKey(CACHE_KEYS.systemPromptsAll()),
    invalidateCacheKey(CACHE_KEYS.systemPromptsActive()),
  ]);
}

/**
 * Invalidate user profile /me cache
 */
export async function invalidateUserMeCache(userId: string | bigint): Promise<void> {
  await invalidateCacheKey(CACHE_KEYS.userMe(userId));
}

/**
 * Invalidate user active sessions list cache
 */
export async function invalidateUserSessionsCache(userId: string | bigint): Promise<void> {
  await invalidateCacheKey(CACHE_KEYS.userSessions(userId));
}

/**
 * Invalidate reset-credit availability & history cache for one connection
 */
export async function invalidateProviderResetCreditsCache(provider: string, connectionId: string | bigint): Promise<void> {
  await Promise.allSettled([
    invalidateCacheKey(CACHE_KEYS.providerResetCredits(provider, connectionId)),
    invalidateCacheKey(CACHE_KEYS.providerResetCreditsHistory(provider, connectionId)),
    invalidateCacheKey(CACHE_KEYS.openaiResetCredits(connectionId)),
    invalidateCacheKey(CACHE_KEYS.openaiResetCreditsHistory(connectionId)),
  ]);
}

/**
 * Invalidate OpenAI reset-credit availability & history cache for one connection
 */
export async function invalidateOpenAiResetCreditsCache(connectionId: string | bigint): Promise<void> {
  await invalidateProviderResetCreditsCache("openai", connectionId);
}
