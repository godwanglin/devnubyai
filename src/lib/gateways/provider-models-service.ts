import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { recordAdminAudit } from "@/lib/admin/audit";
import { bumpRoutingVersion } from "@/lib/routing/settings";
import { validateSafeUrlResolved } from "@/lib/tools/ssrf";
import { getGatewayById } from "@/lib/gateways/repository";
import { resolveOAuthGatewayAuth } from "@/lib/gateways/oauth-dispatch";
import {
  detectCapabilities,
  mergeModelLists,
  parseModelList,
  type DiscoveredModel,
  type ModelCapabilities,
} from "@/lib/oauth/model-capabilities";
import { isOAuthProviderId, type OAuthProviderId } from "@/lib/oauth/providers";
import { CLAUDE_DEFAULT_MODELS } from "@/lib/oauth/constants/claude";
import { getOrCreateOAuthGateway } from "./provider-service";
import { discoverAntigravityModels, pingAntigravityModel } from "./antigravity-models";
import { pingClaudeModel } from "./claude-models";
import { Prisma } from "@/generated/client";

export interface ModelItemDto {
  id: string;
  gatewayId: string;
  modelKey: string;
  ownedBy: string | null;
  isAvailable: boolean;
  capabilities: ModelCapabilities;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ModelPingResult {
  modelKey: string;
  success: boolean;
  httpStatus: number | null;
  latencyMs: number;
  outputPreview?: string;
  error?: string;
}

function sanitizeModelRow(row: {
  id: bigint;
  gatewayId: bigint;
  modelKey: string;
  ownedBy: string | null;
  isAvailable: boolean;
  rawMetadata: unknown;
  firstSeenAt: Date;
  lastSeenAt: Date;
}): ModelItemDto {
  const raw =
    row.rawMetadata && typeof row.rawMetadata === "object" && !Array.isArray(row.rawMetadata)
      ? (row.rawMetadata as Record<string, unknown>)
      : null;
  return {
    id: row.id.toString(),
    gatewayId: row.gatewayId.toString(),
    modelKey: row.modelKey,
    ownedBy: row.ownedBy,
    isAvailable: row.isAvailable,
    capabilities: detectCapabilities(row.modelKey, raw),
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

/** Lists the models already saved in the DB for this OAuth provider. */
export async function listProviderModels(providerId: OAuthProviderId): Promise<ModelItemDto[]> {
  const gw = await getOrCreateOAuthGateway(providerId);
  const rows = await db.upstreamModel.findMany({
    where: { gatewayId: gw.id },
    orderBy: [{ isAvailable: "desc" }, { modelKey: "asc" }],
  });
  return rows.map(sanitizeModelRow);
}

/**
 * Fetches the upstream /models endpoint for this provider using its active OAuth token.
 * For xAI, also queries /language-models when available to pick up richer metadata.
 */
export async function discoverProviderModels(
  providerId: OAuthProviderId
): Promise<{ supported: boolean; models: DiscoveredModel[]; warning?: string }> {
  const gwInfo = await getOrCreateOAuthGateway(providerId);
  const decrypted = await getGatewayById(gwInfo.id);
  if (!decrypted) throw ApiError.notFound("Gateway not found");

  const auth = await resolveOAuthGatewayAuth(decrypted);
  if (!auth) {
    return {
      supported: false,
      models: [],
      warning: "No active OAuth account available to discover models. Connect an account first.",
    };
  }
  if (providerId === "antigravity") return discoverAntigravityModels(auth);

  const modelsUrl = `${decrypted.baseUrl}${
    decrypted.modelsPath.startsWith("/") ? decrypted.modelsPath : `/${decrypted.modelsPath}`
  }`;
  const ssrf = await validateSafeUrlResolved(modelsUrl);
  if (!ssrf.safe) {
    return { supported: false, models: [], warning: `Blocked by SSRF filter: ${ssrf.reason}` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(modelsUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
        ...auth.headers,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        supported: false,
        models: [],
        warning: `Upstream /models returned HTTP ${res.status}${errText ? `: ${errText.slice(0, 160)}` : ""}`,
      };
    }

    const json = await res.json().catch(() => null);
    let list = parseModelList(json);

    // xAI exposes extra fields on /language-models: try it, ignore errors
    if (providerId === "xai") {
      try {
        const richRes = await fetch(`${decrypted.baseUrl}/language-models`, {
          headers: { Accept: "application/json", Authorization: `Bearer ${auth.accessToken}` },
        });
        if (richRes.ok) {
          const richJson = await richRes.json().catch(() => null);
          const richList = parseModelList(richJson);
          if (richList.length > 0) list = mergeModelLists(list, richList);
        }
      } catch {
        // non-fatal
      }
    }

    if (providerId === "claude" && list.length === 0) {
      const fallbackList: DiscoveredModel[] = CLAUDE_DEFAULT_MODELS.map((m) => ({
        modelKey: m.id,
        displayName: m.name,
        ownedBy: "anthropic",
        capabilities: detectCapabilities(m.id, null),
        raw: null,
      }));
      list = mergeModelLists(list, fallbackList);
    }

    return { supported: true, models: list };
  } catch (err: unknown) {
    clearTimeout(timer);
    if (providerId === "claude") {
      const fallbackList: DiscoveredModel[] = CLAUDE_DEFAULT_MODELS.map((m) => ({
        modelKey: m.id,
        displayName: m.name,
        ownedBy: "anthropic",
        capabilities: detectCapabilities(m.id, null),
        raw: null,
      }));
      return { supported: true, models: fallbackList };
    }
    return {
      supported: false,
      models: [],
      warning: err instanceof Error ? err.message : "Network error discovering models",
    };
  }
}

/** Inserts one or more models into upstream_models for this provider's gateway. */
export async function importProviderModels(
  providerId: OAuthProviderId,
  items: Array<{ modelKey: string; ownedBy?: string | null; rawMetadata?: Record<string, unknown> | null }>,
  actorUserId: bigint
): Promise<ModelItemDto[]> {
  if (items.length === 0) return [];
  const gw = await getOrCreateOAuthGateway(providerId, actorUserId);
  const now = new Date();

  const saved = await db.$transaction(async (tx) => {
    const results = [];
    for (const item of items) {
      const key = item.modelKey.trim();
      if (!key) continue;
      const raw = (item.rawMetadata ?? Prisma.JsonNull) as Prisma.InputJsonValue;
      const row = await tx.upstreamModel.upsert({
        where: { gatewayId_modelKey: { gatewayId: gw.id, modelKey: key } },
        create: {
          gatewayId: gw.id,
          modelKey: key,
          ownedBy: item.ownedBy?.trim() || providerId,
          isAvailable: true,
          rawMetadata: raw,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        update: {
          ownedBy: item.ownedBy?.trim() || providerId,
          isAvailable: true,
          rawMetadata: raw,
          lastSeenAt: now,
        },
      });
      results.push(row);
    }

    await recordAdminAudit(
      {
        actorUserId,
        action: "provider_models.import",
        entityType: "upstream_model",
        entityId: gw.id.toString(),
        afterState: { providerId, importedCount: results.length, keys: results.map((r) => r.modelKey) },
      },
      tx
    );
    await bumpRoutingVersion(actorUserId, tx);
    return results;
  });

  return saved.map(sanitizeModelRow);
}

/** Removes a model from this provider. Rejects if active catalog routes point to it. */
export async function deleteProviderModel(
  providerId: OAuthProviderId,
  modelId: bigint,
  actorUserId: bigint
): Promise<void> {
  const gw = await getOrCreateOAuthGateway(providerId, actorUserId);
  const target = await db.upstreamModel.findFirst({
    where: { id: modelId, gatewayId: gw.id },
    select: { id: true, modelKey: true },
  });
  if (!target) throw ApiError.notFound("Model not found on this provider");

  const routesCount = await db.catalogModelRoute.count({
    where: { upstreamModelId: modelId, isEnabled: true },
  });
  if (routesCount > 0) {
    throw ApiError.conflict(
      `Cannot delete model ${target.modelKey}: referenced by ${routesCount} active catalog route(s). Remove or disable those routes first.`
    );
  }

  await db.$transaction(async (tx) => {
    await tx.upstreamModel.delete({ where: { id: modelId } });
    await recordAdminAudit(
      {
        actorUserId,
        action: "provider_models.delete",
        entityType: "upstream_model",
        entityId: modelId.toString(),
        beforeState: { providerId, modelKey: target.modelKey },
      },
      tx
    );
    await bumpRoutingVersion(actorUserId, tx);
  });
}

/** Toggles a model's isAvailable flag. */
export async function toggleProviderModelAvailable(
  providerId: OAuthProviderId,
  modelId: bigint,
  isAvailable: boolean,
  actorUserId: bigint
): Promise<ModelItemDto> {
  const gw = await getOrCreateOAuthGateway(providerId, actorUserId);
  const updated = await db.upstreamModel.update({
    where: { id: modelId, gatewayId: gw.id },
    data: { isAvailable },
  });
  await bumpRoutingVersion(actorUserId);
  return sanitizeModelRow(updated);
}

/**
 * Probes the model with a tiny 1-token prompt to confirm inference works and the account has quota.
 * - xAI: POST /chat/completions (max_tokens: 1)
 * - Grok CLI: POST /responses (max_output_tokens: 1, store: false)
 */
export async function pingProviderModel(
  providerId: OAuthProviderId,
  modelKey: string
): Promise<ModelPingResult> {
  if (!isOAuthProviderId(providerId)) {
    throw ApiError.badRequest(`Unknown provider: ${providerId}`);
  }
  const gwInfo = await getOrCreateOAuthGateway(providerId);
  const decrypted = await getGatewayById(gwInfo.id);
  if (!decrypted) throw ApiError.notFound("Gateway not found");

  const auth = await resolveOAuthGatewayAuth(decrypted);
  if (!auth) {
    return {
      modelKey,
      success: false,
      httpStatus: null,
      latencyMs: 0,
      error: "No active OAuth account available to ping",
    };
  }
  if (providerId === "antigravity") return pingAntigravityModel(auth, modelKey);
  if (providerId === "claude") return pingClaudeModel(auth, modelKey, decrypted.baseUrl);

  const isResponsesApi = providerId === "grok-cli" || providerId === "openai";
  const url = isResponsesApi ? `${decrypted.baseUrl}/responses` : `${decrypted.baseUrl}/chat/completions`;

  const ssrf = await validateSafeUrlResolved(url);
  if (!ssrf.safe) {
    return { modelKey, success: false, httpStatus: null, latencyMs: 0, error: `SSRF blocked: ${ssrf.reason}` };
  }

  const body =
    providerId === "openai"
      ? {
          model: modelKey,
          instructions: "You are a helpful assistant.",
          input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
          stream: true,
          store: false,
        }
      : providerId === "grok-cli"
      ? {
          model: modelKey,
          input: [{ type: "message", role: "user", content: "hi" }],
          stream: false,
          store: false,
          max_output_tokens: 1,
        }
      : {
          model: modelKey,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
          stream: false,
        };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
        ...auth.headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - start;
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = `HTTP ${res.status}`;
      try {
        const errJson = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
        const parsed =
          (typeof errJson.error === "object" ? errJson.error?.message : errJson.error) || errJson.message;
        if (parsed) msg = String(parsed);
      } catch {
        if (text) msg = text.slice(0, 160);
      }
      return { modelKey, success: false, httpStatus: res.status, latencyMs, error: msg };
    }

    let preview = "OK";
    if (providerId === "openai") {
      // Reading the first stream chunk confirms the model accepted the prompt and started emitting
      try {
        const reader = res.body?.getReader();
        if (reader) {
          const chunk = await reader.read();
          if (chunk.value) {
            const dec = new TextDecoder().decode(chunk.value);
            const m = dec.match(/"delta":\s*"([^"]+)"/);
            if (m) preview = m[1];
          }
          await reader.cancel().catch(() => {});
        }
      } catch {
        // stream was at least 200 OK
      }
    } else {
      const text = await res.text().catch(() => "");
      try {
        const okJson = JSON.parse(text) as {
          choices?: Array<{ message?: { content?: string } }>;
          output?: Array<{ type?: string; content?: string; text?: string }>;
        };
        preview =
          okJson.choices?.[0]?.message?.content ||
          okJson.output?.[0]?.content ||
          okJson.output?.[0]?.text ||
          "OK";
      } catch {
        preview = "OK";
      }
    }

    return {
      modelKey,
      success: true,
      httpStatus: res.status,
      latencyMs,
      outputPreview: preview.slice(0, 80),
    };
  } catch (err: unknown) {
    clearTimeout(timer);
    return {
      modelKey,
      success: false,
      httpStatus: null,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Ping request failed",
    };
  }
}
