import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { db } from "@/lib/db";
import { refreshConnectionToken } from "@/lib/oauth/token-refresh";
import {
  CodexUpstreamError,
  fetchOpenAiResetCreditsHistory,
  type ResetCreditsHistoryResult,
} from "@/lib/oauth/quota/openai";
import { fetchClaudeResetGrants } from "@/lib/oauth/quota/claude";
import { getCachedJson, setCachedJson } from "@/lib/redis/client";
import { CACHE_KEYS, CACHE_TTL } from "@/lib/redis/cache-keys";

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

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    await requireAdmin();
    const { providerId, connectionId: rawConnId } = await context.params;

    if (providerId !== "openai" && providerId !== "claude") {
      throw ApiError.badRequest("Reset credits history is only supported for OpenAI and Claude accounts");
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

    // 5-minute cache; ?fresh=1 (the modal's refresh button) bypasses it
    const cacheKey = CACHE_KEYS.providerResetCreditsHistory(providerId, id);
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    if (!fresh) {
      const cached = await getCachedJson<{ result: ResetCreditsHistoryResult; cachedAt: string }>(cacheKey);
      if (cached) return jsonSuccess({ history: cached.result, cachedAt: cached.cachedAt }, { requestId });
    }

    let token = await refreshConnectionToken(id);
    const providerData =
      conn.providerData && typeof conn.providerData === "object" && !Array.isArray(conn.providerData)
        ? (conn.providerData as Record<string, unknown>)
        : null;

    let result: ResetCreditsHistoryResult;
    try {
      if (providerId === "claude") {
        const grantsData = await fetchClaudeResetGrants(token, providerData);
        const items = (grantsData.rawGrants || []).map((g, idx) => ({
          id: `claude_grant_${g.id || idx}`,
          creditId: g.id,
          kind: g.paused ? "paused" : g.resetsLeft > 0 ? "granted" : "used",
          occurredAt: g.startsAt,
          raw: {
            label: g.label,
            resetsLeft: g.resetsLeft,
            resetsTotal: g.resetsTotal,
            clears: g.clears,
            expiresAt: g.endsAt,
          },
        }));
        result = {
          items,
          windowStart: null,
          asOf: new Date().toISOString(),
          nextCursor: null,
        };
      } else {
        result = await fetchOpenAiResetCreditsHistory(token, providerData);
      }
    } catch (err: unknown) {
      const is401 = err instanceof CodexUpstreamError ? err.status === 401 : false;
      if ((is401 || (err instanceof Error && err.message.includes("401"))) && conn.refreshTokenCiphertext) {
        token = await refreshConnectionToken(id, { force: true });
        if (providerId === "claude") {
          const grantsData = await fetchClaudeResetGrants(token, providerData);
          const items = (grantsData.rawGrants || []).map((g, idx) => ({
            id: `claude_grant_${g.id || idx}`,
            creditId: g.id,
            kind: g.paused ? "paused" : g.resetsLeft > 0 ? "granted" : "used",
            occurredAt: g.startsAt,
            raw: {
              label: g.label,
              resetsLeft: g.resetsLeft,
              resetsTotal: g.resetsTotal,
              clears: g.clears,
              expiresAt: g.endsAt,
            },
          }));
          result = {
            items,
            windowStart: null,
            asOf: new Date().toISOString(),
            nextCursor: null,
          };
        } else {
          result = await fetchOpenAiResetCreditsHistory(token, providerData);
        }
      } else {
        throw err;
      }
    }

    const cachedAt = new Date().toISOString();
    await setCachedJson(cacheKey, { result, cachedAt }, CACHE_TTL.OPENAI_RESET_CREDITS);
    return jsonSuccess({ history: result, cachedAt }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
