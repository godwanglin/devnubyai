import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { recordAdminAudit } from "@/lib/admin/audit";
import { bumpRoutingVersion } from "@/lib/routing/settings";
import { validateSafeUrlResolved } from "@/lib/tools/ssrf";
import { getGatewayById } from "@/lib/gateways/repository";
import { resolveOAuthGatewayAuth } from "@/lib/gateways/oauth-dispatch";

export interface GatewayTestResult {
  success: boolean;
  httpStatus: number;
  latencyMs: number;
  modelsFound?: number;
  error?: string;
}

export interface GatewaySyncResult {
  syncedCount: number;
  deletedCount: number;
  lastSyncedAt: string;
}

/**
 * Tests connectivity to an AI gateway by probing its modelsPath with SSRF validation.
 */
export async function testGatewayConnectivity(id: bigint): Promise<GatewayTestResult> {
  const decrypted = await getGatewayById(id);
  if (!decrypted) {
    throw ApiError.notFound("Gateway not found");
  }

  const targetUrlStr = `${decrypted.baseUrl}${
    decrypted.modelsPath.startsWith("/") ? decrypted.modelsPath : `/${decrypted.modelsPath}`
  }`;
  const ssrfCheck = await validateSafeUrlResolved(targetUrlStr);
  if (!ssrfCheck.safe) {
    return {
      success: false,
      httpStatus: 0,
      latencyMs: 0,
      error: `Blocked by SSRF filter: ${ssrfCheck.reason}`,
    };
  }

  let effectiveApiKey = decrypted.apiKey;
  let effectiveHeaders = decrypted.extraHeaders ?? {};
  if (decrypted.authType === "oauth") {
    const oauthAuth = await resolveOAuthGatewayAuth(decrypted).catch(() => null);
    if (!oauthAuth) {
      return { success: false, httpStatus: 0, latencyMs: 0, error: "No active OAuth account available" };
    }
    effectiveApiKey = oauthAuth.accessToken;
    effectiveHeaders = oauthAuth.headers;
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${effectiveApiKey}`,
    ...effectiveHeaders,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  const startTime = Date.now();

  try {
    const res = await fetch(targetUrlStr, {
      method: "GET",
      // Don't forward the gateway API key to wherever a redirect points
      redirect: "manual",
      headers,
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startTime;
    clearTimeout(timer);

    let modelsFound: number | undefined;
    if (res.ok) {
      const json = await res.json().catch(() => null);
      if (json && Array.isArray(json.data)) {
        modelsFound = json.data.length;
      }
    }

    return {
      success: res.ok,
      httpStatus: res.status,
      latencyMs,
      modelsFound,
      error: res.ok ? undefined : `HTTP ${res.status} ${res.statusText}`,
    };
  } catch (err: unknown) {
    clearTimeout(timer);
    const latencyMs = Date.now() - startTime;
    const msg = err instanceof Error ? err.message : "Network/probe error";
    return {
      success: false,
      httpStatus: 0,
      latencyMs,
      error: msg,
    };
  }
}

/**
 * Performs true synchronization against upstream gateway /models endpoint.
 * Upserts valid models returned by upstream, and permanently DELETES models
 * that are no longer returned by the upstream endpoint.
 */
export async function syncGatewayUpstreamModels(
  id: bigint,
  actorUserId: bigint
): Promise<GatewaySyncResult> {
  const decrypted = await getGatewayById(id);
  if (!decrypted) {
    throw ApiError.notFound("Gateway not found");
  }

  const targetUrlStr = `${decrypted.baseUrl}${
    decrypted.modelsPath.startsWith("/") ? decrypted.modelsPath : `/${decrypted.modelsPath}`
  }`;
  const ssrfCheck = await validateSafeUrlResolved(targetUrlStr);
  if (!ssrfCheck.safe) {
    throw ApiError.badRequest(`Unsafe gateway target: ${ssrfCheck.reason}`);
  }

  let effectiveApiKey = decrypted.apiKey;
  let effectiveHeaders = decrypted.extraHeaders ?? {};
  if (decrypted.authType === "oauth") {
    const oauthAuth = await resolveOAuthGatewayAuth(decrypted);
    if (!oauthAuth) {
      throw ApiError.badRequest("Cannot sync models: no active OAuth account for this provider");
    }
    effectiveApiKey = oauthAuth.accessToken;
    effectiveHeaders = oauthAuth.headers;
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${effectiveApiKey}`,
    ...effectiveHeaders,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let rawJson: unknown;
  try {
    const res = await fetch(targetUrlStr, {
      method: "GET",
      // Don't forward the gateway API key to wherever a redirect points
      redirect: "manual",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw ApiError.badRequest(
        `Upstream returned HTTP ${res.status} ${res.statusText} during /models sync`
      );
    }
    rawJson = await res.json();
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof ApiError) throw err;
    const msg = err instanceof Error ? err.message : "Sync network error";
    throw ApiError.badRequest(`Failed to reach upstream /models: ${msg}`);
  }

  if (
    !rawJson ||
    typeof rawJson !== "object" ||
    !Array.isArray((rawJson as { data?: unknown }).data)
  ) {
    throw ApiError.badRequest(
      "Invalid response from upstream: expected OpenAI-compatible { data: [...] } list."
    );
  }

  const list = (rawJson as { data: Array<{ id?: unknown; owned_by?: unknown }> }).data;
  const returnedModelKeys: string[] = [];
  const validItems: Array<{ id: string; owned_by?: string }> = [];

  for (const item of list) {
    if (item && typeof item.id === "string" && item.id.trim().length > 0) {
      const cleanId = item.id.trim();
      returnedModelKeys.push(cleanId);
      validItems.push({
        id: cleanId,
        owned_by: typeof item.owned_by === "string" ? item.owned_by : undefined,
      });
    }
  }

  const now = new Date();

  const syncResult = await db.$transaction(async (tx) => {
    // Upsert all models currently returned by upstream
    for (const item of validItems) {
      await tx.upstreamModel.upsert({
        where: {
          gatewayId_modelKey: {
            gatewayId: id,
            modelKey: item.id,
          },
        },
        create: {
          gatewayId: id,
          modelKey: item.id,
          ownedBy: item.owned_by ?? null,
          isAvailable: true,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        update: {
          ownedBy: item.owned_by ?? null,
          isAvailable: true,
          lastSeenAt: now,
        },
      });
    }

    // Genuinely delete models from DB that are no longer returned by the upstream endpoint
    const deletedResult = await tx.upstreamModel.deleteMany({
      where: {
        gatewayId: id,
        modelKey: {
          notIn: returnedModelKeys,
        },
      },
    });

    const updatedGateway = await tx.gateway.update({
      where: { id },
      data: {
        lastSyncedAt: now,
      },
    });

    await recordAdminAudit(
      {
        actorUserId,
        action: "gateway.sync_models",
        entityType: "gateway",
        entityId: id.toString(),
        afterState: {
          syncedCount: validItems.length,
          deletedCount: deletedResult.count,
          lastSyncedAt: now.toISOString(),
        },
      },
      tx
    );

    await bumpRoutingVersion(actorUserId, tx);

    return {
      syncedCount: validItems.length,
      deletedCount: deletedResult.count,
      lastSyncedAt: updatedGateway.lastSyncedAt?.toISOString() ?? now.toISOString(),
    };
  });

  return syncResult;
}
