import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { recordAdminAudit } from "@/lib/admin/audit";
import type { Prisma } from "@/generated/client";
import { db } from "@/lib/db";
import { refreshConnectionToken } from "@/lib/oauth/token-refresh";
import {
  CodexUpstreamError,
  consumeOpenAiResetCredit,
  fetchOpenAiQuota,
  fetchOpenAiResetCredits,
  type ResetCreditsAvailabilityResult,
} from "@/lib/oauth/quota/openai";
import {
  consumeClaudeResetCredit,
  fetchClaudeQuota,
  fetchClaudeResetGrants,
} from "@/lib/oauth/quota/claude";
import { getCachedJson, setCachedJson } from "@/lib/redis/client";
import {
  CACHE_KEYS,
  CACHE_TTL,
  invalidateProviderResetCreditsCache,
} from "@/lib/redis/cache-keys";
import crypto from "node:crypto";

interface RouteContext {
  params: Promise<{ providerId: string; connectionId: string }>;
}

function parseConnectionId(raw: string): bigint {
  try {
    const id = BigInt(raw);
    if (id <= 0n) throw new Error();
    return id;
  } catch {
    throw ApiError.badRequest("Invalid connection ID");
  }
}

async function loadResetConnection(providerId: string, rawConnId: string) {
  if (providerId !== "openai" && providerId !== "claude") {
    throw ApiError.badRequest("Reset credits are only supported for OpenAI and Claude accounts");
  }
  const id = parseConnectionId(rawConnId);
  const conn = await db.providerConnection.findFirst({
    where: { id, gateway: { oauthProvider: providerId } },
    select: {
      id: true,
      accessTokenCiphertext: true,
      refreshTokenCiphertext: true,
      providerData: true,
    },
  });
  if (!conn) throw ApiError.notFound("Connection not found");
  return { id, conn };
}

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    await requireAdmin();
    const { providerId, connectionId: rawConnId } = await context.params;
    const { id, conn } = await loadResetConnection(providerId, rawConnId);

    // 5-minute cache; ?fresh=1 (the modal's refresh button) bypasses it
    const cacheKey = CACHE_KEYS.providerResetCredits(providerId, id);
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    if (!fresh) {
      const cached = await getCachedJson<{ result: ResetCreditsAvailabilityResult; cachedAt: string }>(cacheKey);
      if (cached) return jsonSuccess({ resetCredits: cached.result, cachedAt: cached.cachedAt }, { requestId });
    }

    // Get fresh token (refreshes if within lead window)
    let token = await refreshConnectionToken(id);
    const providerData =
      conn.providerData && typeof conn.providerData === "object" && !Array.isArray(conn.providerData)
        ? (conn.providerData as Record<string, unknown>)
        : null;

    let result: ResetCreditsAvailabilityResult;
    try {
      if (providerId === "claude") {
        result = await fetchClaudeResetGrants(token, providerData);
      } else {
        result = await fetchOpenAiResetCredits(token, providerData);
      }
    } catch (err: unknown) {
      // 401: force a token refresh and retry once
      const is401 = err instanceof CodexUpstreamError ? err.status === 401 : false;
      if ((is401 || (err instanceof Error && err.message.includes("401"))) && conn.refreshTokenCiphertext) {
        token = await refreshConnectionToken(id, { force: true });
        if (providerId === "claude") {
          result = await fetchClaudeResetGrants(token, providerData);
        } else {
          result = await fetchOpenAiResetCredits(token, providerData);
        }
      } else {
        throw err;
      }
    }

    const cachedAt = new Date().toISOString();
    await setCachedJson(cacheKey, { result, cachedAt }, CACHE_TTL.OPENAI_RESET_CREDITS);
    return jsonSuccess({ resetCredits: result, cachedAt }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const admin = await requireAdmin();
    const { providerId, connectionId: rawConnId } = await context.params;
    const { id, conn } = await loadResetConnection(providerId, rawConnId);

    let token = await refreshConnectionToken(id);
    const providerData =
      conn.providerData && typeof conn.providerData === "object" && !Array.isArray(conn.providerData)
        ? (conn.providerData as Record<string, unknown>)
        : null;

    let result;
    if (providerId === "claude") {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const grantId = typeof body.grantId === "string" ? body.grantId : null;
      result = await consumeClaudeResetCredit(token, grantId, providerData);

      if (!result.ok && result.status === 401 && conn.refreshTokenCiphertext) {
        try {
          token = await refreshConnectionToken(id, { force: true });
          result = await consumeClaudeResetCredit(token, grantId, providerData);
        } catch {
          // keep original result
        }
      }
    } else {
      // Server-generated redeem id prevents client-controlled replay
      const redeemRequestId = crypto.randomUUID();
      result = await consumeOpenAiResetCredit(token, redeemRequestId, providerData);

      if (!result.ok && result.status === 401 && conn.refreshTokenCiphertext) {
        try {
          token = await refreshConnectionToken(id, { force: true });
          result = await consumeOpenAiResetCredit(token, redeemRequestId, providerData);
        } catch {
          // use original result
        }
      }
    }

    if (result.noCredit) {
      throw ApiError.conflict(
        providerId === "claude"
          ? "No Claude reset grants available for this account"
          : "No OpenAI reset credits available for this account"
      );
    }

    if (!result.ok) {
      throw new ApiError(502, "INTERNAL_ERROR", result.message || "Failed to consume reset credit");
    }

    // Availability & history changed upstream: drop caches
    await invalidateProviderResetCreditsCache(providerId, id);

    // Refresh cached quota after successful consumption & clear cooldown
    const freshQuota =
      providerId === "claude"
        ? await fetchClaudeQuota(token, providerData).catch(() => null)
        : await fetchOpenAiQuota(token, providerData).catch(() => null);

    await db.providerConnection.update({
      where: { id },
      data: {
        cooldownUntil: null,
        lastError: null,
        ...(freshQuota ? { quotaCached: freshQuota as unknown as Prisma.InputJsonValue, quotaCheckedAt: new Date() } : {}),
      },
    });

    await recordAdminAudit({
      actorUserId: admin.id,
      action: "provider_connection.consume_reset_credit",
      entityType: "provider_connection",
      entityId: id.toString(),
      afterState: {
        providerId,
        windowsReset: result.windowsReset,
        code: result.code,
      },
    });

    return jsonSuccess(
      {
        consumed: true,
        windowsReset: result.windowsReset,
        code: result.code,
        quota: freshQuota,
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
