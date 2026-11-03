import crypto from "node:crypto";
import { db } from "@/lib/db";
import { GatewayError } from "@/lib/routing/errors";
import { refreshConnectionToken } from "@/lib/oauth/token-refresh";
import { GROK_CLI_DEFAULT_CUSTOM_HEADERS } from "@/lib/oauth/constants/grok-cli";
import {
  CODEX_DEFAULT_INSTRUCTIONS,
  OPENAI_DEFAULT_CUSTOM_HEADERS,
} from "@/lib/oauth/constants/openai";
import { CLAUDE_DEFAULT_CUSTOM_HEADERS } from "@/lib/oauth/constants/claude";
import type { ProviderQuotaResult } from "@/lib/oauth/quota";
import { isOtherAntigravityFamily } from "@/lib/oauth/quota/antigravity";
import { buildAntigravityHeaders, resolveAntigravityProjectId } from "./antigravity-auth";
import type {
  ChatMessageInput,
  DecryptedGatewayConfig,
  GatewayExecutionRequest,
  GatewayStreamEvent,
} from "./types";

type InnerDispatch = (
  gateway: DecryptedGatewayConfig,
  request: GatewayExecutionRequest
) => AsyncGenerator<GatewayStreamEvent>;

export interface PoolConnection {
  id: bigint;
  email: string | null;
  upstreamUserId: string | null;
  expiresAt: Date | null;
  hasRefreshToken: boolean;
  quotaCached: ProviderQuotaResult | null;
  providerData: Record<string, unknown> | null;
}

const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
const QUOTA_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * Models supported by OpenAI / ChatGPT accounts on the "free" plan (the green cards).
 * Any other model (e.g. sol, astra, daybreak) requires a paid tier (plus/pro/team).
 * Strips optional cx/ prefix, whitespace, and lowercases for matching.
 */
export const OPENAI_FREE_PLAN_ALLOWED_MODELS = new Set<string>([
  "gpt-6-luna",
  "gpt-6-luna[1m]",
  "gpt-5.6-terra",
  "gpt-5.6-terra[1m]",
  "gpt-5.6-terra-review",
  "gpt-5.6-luna",
  "gpt-5.6-luna[1m]",
  "gpt-5.6-luna-review",
  "gpt-reserve",
  "codex-auto-review",
]);

export function normalizeModelKey(rawModel: string): string {
  return rawModel.trim().toLowerCase().replace(/^cx\//i, "");
}

export function isOpenAiModelAllowedForFree(rawModel: string): boolean {
  const normalized = normalizeModelKey(rawModel);
  return OPENAI_FREE_PLAN_ALLOWED_MODELS.has(normalized);
}

/** Check if an account's cached quota is currently depleted for the requested model. */
export function isConnectionQuotaExhausted(conn: PoolConnection, now = Date.now(), model?: string): boolean {
  const qc = conn.quotaCached;
  if (!qc || !qc.supported) return false;

  // Global flag: true only if every window on the account is depleted
  if (qc.exhausted) {
    if (qc.periodEnd) {
      const resetTime = Date.parse(qc.periodEnd);
      if (Number.isFinite(resetTime) && resetTime <= now) return false;
    }
    return true;
  }

  // Check individual windows (session / weekly). For providers with multi-family quotas
  // (Antigravity: gemini_* vs claude_gpt_*), windows of other families are ignored.
  const quotas = qc.quotas || {};
  for (const [key, q] of Object.entries(quotas)) {
    if (!q || q.unlimited) continue;
    if (isOtherAntigravityFamily(key, model)) continue;
    if (q.remainingPercentage <= 0) {
      if (q.resetAt) {
        const resetTime = Date.parse(q.resetAt);
        if (Number.isFinite(resetTime) && resetTime <= now) continue;
      }
      return true;
    }
  }

  return false;
}

export function getConnectionPlanType(conn: PoolConnection): string {
  const fromPd = typeof conn.providerData?.chatgptPlanType === "string" ? conn.providerData.chatgptPlanType : null;
  const fromQuota = typeof conn.quotaCached?.plan === "string" ? conn.quotaCached.plan : null;
  return (fromPd || fromQuota || "").toLowerCase().trim();
}

/** Enabled accounts not cooling down, in admin-defined order. */
export async function loadConnectionPool(gatewayId: bigint, now = new Date()): Promise<PoolConnection[]> {
  const rows = await db.providerConnection.findMany({
    where: {
      gatewayId,
      isEnabled: true,
      OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }],
    },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      email: true,
      upstreamUserId: true,
      expiresAt: true,
      refreshTokenCiphertext: true,
      quotaCached: true,
      providerData: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    upstreamUserId: r.upstreamUserId,
    expiresAt: r.expiresAt,
    hasRefreshToken: r.refreshTokenCiphertext !== null,
    quotaCached: (r.quotaCached as ProviderQuotaResult | null) ?? null,
    providerData: (r.providerData && typeof r.providerData === "object" && !Array.isArray(r.providerData)
      ? (r.providerData as Record<string, unknown>)
      : null),
  }));
}

/** Deterministic UUID-shaped id so one conversation keeps the same Grok session headers. */
function stableUuid(seed: string): string {
  const h = crypto.createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function firstUserText(messages: ChatMessageInput[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "";
  if (typeof first.content === "string") return first.content.slice(0, 2000);
  return first.content
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .slice(0, 2000);
}

export function supportsGrokCliReasoningEffort(model: string): boolean {
  return /^grok-4\.5(?:$|-)/.test(model);
}

/**
 * Per-request headers the official Grok CLI sends (from the 9router wire capture).
 * Admin custom headers come first so they can override the identity defaults.
 */
export function buildGrokCliHeaders(
  conn: Pick<PoolConnection, "id" | "email" | "upstreamUserId">,
  request: GatewayExecutionRequest,
  customHeaders: Record<string, string> | null
): Record<string, string> {
  const sessionId = stableUuid(`grok-cli:${conn.id}:${firstUserText(request.messages)}`);
  const turns = Math.max(1, request.messages.filter((m) => m.role === "user").length);
  const headers: Record<string, string> = {
    ...GROK_CLI_DEFAULT_CUSTOM_HEADERS,
    ...(customHeaders ?? {}),
    "x-xai-token-auth": "xai-grok-cli",
    "x-grok-session-id": sessionId,
    "x-grok-conv-id": sessionId,
    "x-grok-req-id": crypto.randomUUID(),
    "x-grok-turn-idx": String(turns),
    "x-grok-agent-id": stableUuid(`grok-cli-agent:${conn.id}`),
    "x-grok-model-override": request.model,
  };
  if (conn.email) headers["x-email"] = conn.email;
  if (conn.upstreamUserId) headers["x-userid"] = conn.upstreamUserId;
  return headers;
}

/** ChatGPT Codex identity headers; ChatGPT-Account-ID keeps multi-account pools from cross-binding. */
export function buildOpenAiCodexHeaders(
  conn: Pick<PoolConnection, "id" | "providerData">,
  request: GatewayExecutionRequest,
  customHeaders: Record<string, string> | null
): Record<string, string> {
  const sessionId = stableUuid(`codex:${conn.id}:${firstUserText(request.messages)}`);
  const headers: Record<string, string> = {
    ...OPENAI_DEFAULT_CUSTOM_HEADERS,
    ...(customHeaders ?? {}),
    session_id: sessionId,
  };
  const accountId =
    (typeof conn.providerData?.chatgptAccountId === "string" && conn.providerData.chatgptAccountId) ||
    (typeof conn.providerData?.workspaceId === "string" && conn.providerData.workspaceId) ||
    (typeof conn.providerData?.accountId === "string" && conn.providerData.accountId);
  if (accountId) headers["ChatGPT-Account-ID"] = accountId;
  return headers;
}

/** Body overrides expected by the ChatGPT Codex /responses endpoint. */
export function buildOpenAiCodexParamOverrides(request: GatewayExecutionRequest): Record<string, unknown> {
  const effort = request.reasoningEffort;
  const reasoningOn = effort !== "off";
  const overrides: Record<string, unknown> = {
    store: false,
    // Codex Responses API rejects these sampling/limit parameters (undefined drops them from the JSON body)
    temperature: undefined,
    top_p: undefined,
    max_output_tokens: undefined,
    ...(reasoningOn
      ? {
          reasoning: { ...(effort ? { effort } : {}), summary: "auto" },
          include: ["reasoning.encrypted_content"],
        }
      : {}),
    ...(request.paramOverrides ?? {}),
  };
  return overrides;
}

/**
 * Codex requires `instructions`. The responses adapter turns system messages
 * into `instructions`, so add a neutral system message when the request has none.
 */
export function prepareCodexMessages(messages: ChatMessageInput[]): ChatMessageInput[] {
  if (messages.some((m) => m.role === "system")) return messages;
  return [{ role: "system", content: CODEX_DEFAULT_INSTRUCTIONS }, ...messages];
}

/** Body tweaks cli-chat-proxy expects: no server-side storage, encrypted reasoning continuity. */
export function buildGrokCliParamOverrides(request: GatewayExecutionRequest): Record<string, unknown> {
  const reasoning: Record<string, unknown> = { summary: "concise" };
  const effort = request.reasoningEffort;
  if (effort && effort !== "off" && supportsGrokCliReasoningEffort(request.model)) {
    reasoning.effort = effort;
  }
  return {
    store: false,
    reasoning,
    include: ["reasoning.encrypted_content"],
    ...(request.paramOverrides ?? {}),
  };
}

async function buildAttempt(
  gateway: DecryptedGatewayConfig,
  conn: PoolConnection,
  accessToken: string,
  request: GatewayExecutionRequest
): Promise<{ gateway: DecryptedGatewayConfig; request: GatewayExecutionRequest }> {
  if (gateway.oauthProvider === "antigravity") {
    const projectId = await resolveAntigravityProjectId(conn, accessToken);
    return {
      gateway: { ...gateway, apiKey: accessToken, extraHeaders: buildAntigravityHeaders(conn.id, projectId, gateway.extraHeaders) },
      request,
    };
  }
  if (gateway.oauthProvider === "grok-cli") {
    return {
      gateway: { ...gateway, apiKey: accessToken, extraHeaders: buildGrokCliHeaders(conn, request, gateway.extraHeaders) },
      request: { ...request, paramOverrides: buildGrokCliParamOverrides(request) },
    };
  }
  if (gateway.oauthProvider === "openai") {
    return {
      gateway: { ...gateway, apiKey: accessToken, extraHeaders: buildOpenAiCodexHeaders(conn, request, gateway.extraHeaders) },
      request: {
        ...request,
        messages: prepareCodexMessages(request.messages),
        paramOverrides: buildOpenAiCodexParamOverrides(request),
      },
    };
  }
  if (gateway.oauthProvider === "claude") {
    const sessionId = stableUuid(`claude:${conn.id}:${firstUserText(request.messages)}`);
    return {
      gateway: {
        ...gateway,
        apiKey: accessToken,
        extraHeaders: {
          ...CLAUDE_DEFAULT_CUSTOM_HEADERS,
          ...(gateway.extraHeaders ?? {}),
          Authorization: `Bearer ${accessToken}`,
          "x-claude-code-session-id": sessionId,
        },
      },
      request,
    };
  }
  return { gateway: { ...gateway, apiKey: accessToken }, request };
}

function cooldownFor(error: GatewayError, conn: PoolConnection, now: number): Date | null {
  if (error.httpStatus === 402) {
    const periodEnd = conn.quotaCached?.periodEnd ? Date.parse(conn.quotaCached.periodEnd) : NaN;
    return new Date(Number.isFinite(periodEnd) && periodEnd > now ? periodEnd : now + QUOTA_COOLDOWN_MS);
  }
  if (error.errorClass === "rate_limited") return new Date(now + RATE_LIMIT_COOLDOWN_MS);
  return null;
}

/** Errors another account of the same provider may not hit; everything else goes to route fallback. */
function isAccountScoped(error: GatewayError): boolean {
  return error.errorClass === "auth" || error.errorClass === "rate_limited" || error.httpStatus === 402;
}

async function noteConnectionError(id: bigint, error: GatewayError, cooldownUntil: Date | null): Promise<void> {
  await db.providerConnection
    .update({
      where: { id },
      data: {
        lastError: `${error.httpStatus ?? error.errorClass}: ${error.rawProviderError ?? error.providerError}`.slice(0, 500),
        ...(cooldownUntil ? { cooldownUntil } : {}),
      },
    })
    .catch(() => {});
}

/**
 * Stream through an OAuth gateway: try its accounts in order until one yields
 * the first event. 401 refreshes the token once; 402/429/auth move to the next
 * account (402 and 429 also park the account). Once an event was yielded the
 * stream is committed to that account, matching the route-level executor.
 */
export async function* executeOAuthGateway(
  gateway: DecryptedGatewayConfig,
  request: GatewayExecutionRequest,
  inner: InnerDispatch,
  deps: {
    loadPool?: typeof loadConnectionPool;
    getToken?: (id: bigint, force: boolean) => Promise<string>;
    onCommitted?: (id: bigint) => Promise<void>;
    onError?: (id: bigint, error: GatewayError, cooldownUntil: Date | null) => Promise<void>;
  } = {}
): AsyncGenerator<GatewayStreamEvent> {
  const loadPool = deps.loadPool ?? loadConnectionPool;
  const getToken = deps.getToken ?? ((id: bigint, force: boolean) => refreshConnectionToken(id, { force }));
  const onCommitted =
    deps.onCommitted ??
    ((id: bigint) =>
      db.providerConnection
        .update({ where: { id }, data: { lastUsedAt: new Date(), lastError: null } })
        .then(() => {})
        .catch(() => {}));
  const onError = deps.onError ?? noteConnectionError;

  const fullPool = await loadPool(gateway.id);
  if (fullPool.length === 0) {
    throw new GatewayError({
      errorClass: "auth",
      httpStatus: null,
      message: `No active OAuth account for ${gateway.name}`,
    });
  }

  // Skip accounts with depleted quota, and free-plan OpenAI accounts for paid-only models
  const nowMs = Date.now();
  const freeAllowed = gateway.oauthProvider !== "openai" || isOpenAiModelAllowedForFree(request.model);
  let skippedQuota = 0;
  let skippedPlan = 0;
  const pool = fullPool.filter((conn) => {
    if (isConnectionQuotaExhausted(conn, nowMs, request.model)) {
      skippedQuota += 1;
      return false;
    }
    if (!freeAllowed && getConnectionPlanType(conn) === "free") {
      skippedPlan += 1;
      return false;
    }
    return true;
  });

  if (pool.length === 0) {
    const reasons = [
      skippedQuota > 0 ? `${skippedQuota} kuota habis` : null,
      skippedPlan > 0 ? `${skippedPlan} plan free tidak mendukung model ${request.model}` : null,
    ].filter(Boolean);
    const detail = `No eligible OAuth account for ${gateway.name} (${reasons.join(", ")})`;
    throw new GatewayError({
      errorClass: skippedQuota > 0 && skippedPlan === 0 ? "rate_limited" : "auth",
      httpStatus: null,
      message: detail,
      // Keep the skip reason in admin telemetry instead of the generic mapped text
      providerError: detail,
    });
  }

  let lastError: GatewayError | null = null;

  for (const conn of pool) {
    let accessToken: string;
    try {
      accessToken = await getToken(conn.id, false);
    } catch (err) {
      lastError = new GatewayError({
        errorClass: "auth",
        httpStatus: null,
        message: err instanceof Error ? err.message : "Token refresh failed",
      });
      continue;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const prepared = await buildAttempt(gateway, conn, accessToken, request);
      const stream = inner(prepared.gateway, prepared.request);
      let committed = false;
      try {
        for await (const event of stream) {
          if (!committed) {
            committed = true;
            void onCommitted(conn.id);
          }
          yield event;
        }
        return;
      } catch (err) {
        if (committed || !(err instanceof GatewayError) || err.errorClass === "client_aborted") throw err;

        // Expired/revoked access token: refresh once and retry the same account
        if (err.httpStatus === 401 && attempt === 0 && conn.hasRefreshToken) {
          try {
            accessToken = await getToken(conn.id, true);
            continue;
          } catch {
            // fall through: treat as an account failure
          }
        }

        if (!isAccountScoped(err)) throw err;
        await onError(conn.id, err, cooldownFor(err, conn, Date.now()));
        lastError = err;
        break;
      }
    }
  }

  throw (
    lastError ??
    new GatewayError({ errorClass: "auth", httpStatus: null, message: `All OAuth accounts failed for ${gateway.name}` })
  );
}

/** First usable account's credentials, for model sync and connectivity tests. */
export async function resolveOAuthGatewayAuth(
  gateway: DecryptedGatewayConfig
): Promise<{ accessToken: string; headers: Record<string, string> } | null> {
  const [conn] = await loadConnectionPool(gateway.id);
  if (!conn) return null;
  const accessToken = await refreshConnectionToken(conn.id);
  const headers: Record<string, string> = { ...(gateway.extraHeaders ?? {}) };
  if (gateway.oauthProvider === "grok-cli") {
    Object.assign(headers, GROK_CLI_DEFAULT_CUSTOM_HEADERS, gateway.extraHeaders ?? {}, {
      "x-xai-token-auth": "xai-grok-cli",
      "x-grok-client-mode": "headless",
    });
    if (conn.email) headers["x-email"] = conn.email;
    if (conn.upstreamUserId) headers["x-userid"] = conn.upstreamUserId;
  }
  if (gateway.oauthProvider === "openai") {
    Object.assign(headers, OPENAI_DEFAULT_CUSTOM_HEADERS, gateway.extraHeaders ?? {});
    const accountId = conn.providerData?.chatgptAccountId;
    if (typeof accountId === "string" && accountId) headers["ChatGPT-Account-ID"] = accountId;
  }
  if (gateway.oauthProvider === "antigravity") {
    const projectId = await resolveAntigravityProjectId(conn, accessToken);
    Object.assign(headers, buildAntigravityHeaders(conn.id, projectId, gateway.extraHeaders));
  }
  if (gateway.oauthProvider === "claude") {
    Object.assign(headers, CLAUDE_DEFAULT_CUSTOM_HEADERS, gateway.extraHeaders ?? {});
  }
  return { accessToken, headers };
}
