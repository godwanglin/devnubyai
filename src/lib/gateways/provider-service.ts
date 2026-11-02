import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto/vault";
import { recordAdminAudit } from "@/lib/admin/audit";
import { bumpRoutingVersion } from "@/lib/routing/settings";
import { ApiError } from "@/lib/api/response";
import {
  OAUTH_PROVIDERS,
  type OAuthProviderId,
} from "@/lib/oauth/providers";
import { fetchProviderQuota, isQuotaSupported, type ProviderQuotaResult } from "@/lib/oauth/quota";
import { refreshConnectionToken } from "@/lib/oauth/token-refresh";
import type { Prisma } from "@/generated/client";

export interface SanitizedProviderConnectionDto {
  id: string;
  gatewayId: string;
  label: string | null;
  email: string | null;
  displayName: string | null;
  upstreamUserId: string | null;
  scope: string | null;
  expiresAt: string | null;
  quotaCached: ProviderQuotaResult | null;
  quotaCheckedAt: string | null;
  cooldownUntil: string | null;
  lastError: string | null;
  isEnabled: boolean;
  sortOrder: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderDetailDto {
  providerId: OAuthProviderId;
  name: string;
  description: string;
  flow: "pkce" | "device_code";
  iconKey: string;
  logoUrl: string | null;
  baseUrl: string;
  wireApi: "chat" | "responses";
  gatewayId: string;
  customHeaders: Record<string, string>;
  defaultCustomHeaders: Record<string, string>;
  connections: SanitizedProviderConnectionDto[];
  quotaSupported: boolean;
}

/**
 * Ensure a backing Gateway record exists for this OAuth provider.
 * Hidden from plain /admin/gateway listing by auth_type = 'oauth'.
 */
export async function getOrCreateOAuthGateway(
  providerId: OAuthProviderId,
  actorUserId?: bigint
): Promise<{ id: bigint; slug: string; extraHeaders: Record<string, string> | null; baseUrl: string }> {
  const existing = await db.gateway.findUnique({
    where: { oauthProvider: providerId },
    select: { id: true, slug: true, extraHeaders: true, baseUrl: true },
  });

  if (existing) {
    let headers: Record<string, string> | null = null;
    if (existing.extraHeaders && typeof existing.extraHeaders === "object" && !Array.isArray(existing.extraHeaders)) {
      headers = existing.extraHeaders as Record<string, string>;
    }
    return { id: existing.id, slug: existing.slug, extraHeaders: headers, baseUrl: existing.baseUrl };
  }

  const manifest = OAUTH_PROVIDERS[providerId];
  const dummyKey = encryptSecret(`oauth-gateway-placeholder-${providerId}`);

  const created = await db.gateway.create({
    data: {
      slug: `oauth-${providerId}`,
      name: manifest.name,
      baseUrl: manifest.defaultBaseUrl,
      wireApi: manifest.wireApi,
      modelsPath: manifest.defaultModelsPath,
      apiKeyCiphertext: dummyKey,
      apiKeyLast4: "OATH",
      authType: "oauth",
      oauthProvider: providerId,
      extraHeaders: manifest.defaultCustomHeaders as Prisma.InputJsonValue,
      isEnabled: true,
      priority: 100,
    },
    select: { id: true, slug: true, extraHeaders: true, baseUrl: true },
  });

  // Models are never seeded from code: the admin imports them via "Add Model"
  if (actorUserId) {
    await bumpRoutingVersion(actorUserId);
  }

  return {
    id: created.id,
    slug: created.slug,
    extraHeaders: manifest.defaultCustomHeaders,
    baseUrl: created.baseUrl,
  };
}

export function sanitizeConnection(c: {
  id: bigint;
  gatewayId: bigint;
  label: string | null;
  email: string | null;
  displayName: string | null;
  upstreamUserId: string | null;
  scope: string | null;
  expiresAt: Date | null;
  quotaCached: unknown;
  quotaCheckedAt: Date | null;
  cooldownUntil: Date | null;
  lastError: string | null;
  isEnabled: boolean;
  sortOrder: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): SanitizedProviderConnectionDto {
  return {
    id: c.id.toString(),
    gatewayId: c.gatewayId.toString(),
    label: c.label,
    email: c.email,
    displayName: c.displayName,
    upstreamUserId: c.upstreamUserId,
    scope: c.scope,
    expiresAt: c.expiresAt?.toISOString() ?? null,
    quotaCached: (c.quotaCached as ProviderQuotaResult) ?? null,
    quotaCheckedAt: c.quotaCheckedAt?.toISOString() ?? null,
    cooldownUntil: c.cooldownUntil?.toISOString() ?? null,
    lastError: c.lastError,
    isEnabled: c.isEnabled,
    sortOrder: c.sortOrder,
    lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/**
 * List all supported OAuth providers with active/total connection counts.
 */
export async function listOAuthProvidersSummary() {
  const providers = Object.values(OAUTH_PROVIDERS);

  const summaries = await Promise.all(
    providers.map(async (p) => {
      const gw = await db.gateway.findUnique({
        where: { oauthProvider: p.id },
        select: { id: true, isEnabled: true },
      });

      if (!gw) {
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          flow: p.flow,
          iconKey: p.iconKey,
          logoUrl: p.logoUrl ?? null,
          connectionCount: 0,
          activeCount: 0,
          isGatewayConfigured: false,
        };
      }

      const [total, active] = await Promise.all([
        db.providerConnection.count({ where: { gatewayId: gw.id } }),
        db.providerConnection.count({ where: { gatewayId: gw.id, isEnabled: true } }),
      ]);

      return {
        id: p.id,
        name: p.name,
        description: p.description,
        flow: p.flow,
        iconKey: p.iconKey,
        logoUrl: p.logoUrl ?? null,
        connectionCount: total,
        activeCount: active,
        isGatewayConfigured: true,
      };
    })
  );

  return summaries;
}

/**
 * Get detailed configuration for a specific provider.
 */
export async function getProviderDetail(
  providerId: OAuthProviderId,
  actorUserId?: bigint
): Promise<ProviderDetailDto> {
  const manifest = OAUTH_PROVIDERS[providerId];
  const gw = await getOrCreateOAuthGateway(providerId, actorUserId);

  const rawConnections = await db.providerConnection.findMany({
    where: { gatewayId: gw.id },
    orderBy: { sortOrder: "asc" },
  });

  const customHeaders = gw.extraHeaders ?? manifest.defaultCustomHeaders;

  return {
    providerId,
    name: manifest.name,
    description: manifest.description,
    flow: manifest.flow,
    iconKey: manifest.iconKey,
    logoUrl: manifest.logoUrl ?? null,
    baseUrl: gw.baseUrl,
    wireApi: manifest.wireApi,
    gatewayId: gw.id.toString(),
    customHeaders,
    defaultCustomHeaders: manifest.defaultCustomHeaders,
    connections: rawConnections.map(sanitizeConnection),
    quotaSupported: isQuotaSupported(providerId),
  };
}

/**
 * Update custom headers on backing gateway.
 */
export async function updateProviderCustomHeaders(
  providerId: OAuthProviderId,
  headers: Record<string, string>,
  actorUserId: bigint
): Promise<Record<string, string>> {
  const gw = await getOrCreateOAuthGateway(providerId, actorUserId);

  await db.gateway.update({
    where: { id: gw.id },
    data: { extraHeaders: headers as Prisma.InputJsonValue },
  });

  await recordAdminAudit({
    actorUserId,
    action: "gateway.update_custom_headers",
    entityType: "gateway",
    entityId: gw.id.toString(),
    afterState: { providerId, headers },
  });

  await bumpRoutingVersion(actorUserId);
  return headers;
}

/**
 * Save new OAuth connection from exchange/poll.
 */
export async function saveNewConnection(
  providerId: OAuthProviderId,
  data: {
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    expiresIn?: number;
    scope?: string;
    email?: string | null;
    displayName?: string | null;
    upstreamUserId?: string | null;
    providerData?: Record<string, unknown>;
    label?: string;
  },
  actorUserId: bigint
): Promise<SanitizedProviderConnectionDto> {
  const gw = await getOrCreateOAuthGateway(providerId, actorUserId);

  // Highest sort order + 10 so it's placed at the bottom initially
  const maxOrder = await db.providerConnection.findFirst({
    where: { gatewayId: gw.id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const nextOrder = (maxOrder?.sortOrder ?? 0) + 10;

  const accessTokenCiphertext = encryptSecret(data.accessToken);
  const refreshTokenCiphertext = data.refreshToken ? encryptSecret(data.refreshToken) : null;
  const idTokenCiphertext = data.idToken ? encryptSecret(data.idToken) : null;
  const expiresAt = data.expiresIn ? new Date(Date.now() + data.expiresIn * 1000) : null;

  const created = await db.providerConnection.create({
    data: {
      gatewayId: gw.id,
      label: data.label || data.displayName || data.email || `Account ${nextOrder / 10}`,
      email: data.email,
      displayName: data.displayName,
      upstreamUserId: data.upstreamUserId,
      accessTokenCiphertext,
      refreshTokenCiphertext,
      idTokenCiphertext,
      scope: data.scope,
      expiresAt,
      providerData: (data.providerData ?? undefined) as Prisma.InputJsonValue | undefined,
      isEnabled: true,
      sortOrder: nextOrder,
    },
  });

  // Background fetch quota on connect if supported
  if (isQuotaSupported(providerId)) {
    void refreshSingleConnectionQuota(created.id, providerId).catch(() => {});
  }

  await recordAdminAudit({
    actorUserId,
    action: "provider_connection.create",
    entityType: "provider_connection",
    entityId: created.id.toString(),
    afterState: { providerId, email: data.email, label: created.label },
  });

  await bumpRoutingVersion(actorUserId);
  return sanitizeConnection(created);
}

/**
 * Reorder connections by updating sortOrder.
 */
export async function reorderConnections(
  providerId: OAuthProviderId,
  orderedConnectionIds: bigint[],
  actorUserId: bigint
): Promise<void> {
  const gw = await getOrCreateOAuthGateway(providerId, actorUserId);

  await db.$transaction(async (tx) => {
    let order = 10;
    for (const id of orderedConnectionIds) {
      await tx.providerConnection.updateMany({
        where: { id, gatewayId: gw.id },
        data: { sortOrder: order },
      });
      order += 10;
    }
  });

  await bumpRoutingVersion(actorUserId);
}

/** Throws 404 unless the connection belongs to this provider's gateway. */
async function assertConnectionOfProvider(providerId: OAuthProviderId, connectionId: bigint): Promise<void> {
  const conn = await db.providerConnection.findFirst({
    where: { id: connectionId, gateway: { oauthProvider: providerId } },
    select: { id: true },
  });
  if (!conn) throw ApiError.notFound("Connection not found");
}

/**
 * Toggle connection enabled status or label.
 */
export async function updateConnection(
  providerId: OAuthProviderId,
  connectionId: bigint,
  data: { isEnabled?: boolean; label?: string },
  actorUserId: bigint
): Promise<SanitizedProviderConnectionDto> {
  await assertConnectionOfProvider(providerId, connectionId);
  const updated = await db.providerConnection.update({
    where: { id: connectionId },
    data: {
      ...(data.isEnabled !== undefined ? { isEnabled: data.isEnabled } : {}),
      ...(data.label !== undefined ? { label: data.label } : {}),
    },
  });

  await recordAdminAudit({
    actorUserId,
    action: "provider_connection.update",
    entityType: "provider_connection",
    entityId: connectionId.toString(),
    afterState: { providerId, ...data },
  });
  await bumpRoutingVersion(actorUserId);
  return sanitizeConnection(updated);
}

/**
 * Delete connection.
 */
export async function deleteConnection(
  providerId: OAuthProviderId,
  connectionId: bigint,
  actorUserId: bigint
): Promise<void> {
  await assertConnectionOfProvider(providerId, connectionId);
  await db.providerConnection.delete({
    where: { id: connectionId },
  });

  await recordAdminAudit({
    actorUserId,
    action: "provider_connection.delete",
    entityType: "provider_connection",
    entityId: connectionId.toString(),
    beforeState: { providerId },
  });
  await bumpRoutingVersion(actorUserId);
}

/**
 * Fetch and update quota for a single connection.
 */
export async function refreshSingleConnectionQuota(
  connectionId: bigint,
  providerId: OAuthProviderId
): Promise<ProviderQuotaResult> {
  const conn = await db.providerConnection.findFirst({
    where: { id: connectionId, gateway: { oauthProvider: providerId } },
    select: {
      id: true,
      providerData: true,
    },
  });

  if (!conn) throw ApiError.notFound("Connection not found");

  // Refresh token if needed
  const accessToken = await refreshConnectionToken(connectionId);
  const quota = await fetchProviderQuota(
    providerId,
    accessToken,
    conn.providerData as Record<string, unknown> | null
  );

  const cooldownUntil = quota.exhausted
    ? quota.periodEnd
      ? new Date(quota.periodEnd)
      : new Date(Date.now() + 60 * 60 * 1000)
    : null;

  await db.providerConnection.update({
    where: { id: connectionId },
    data: {
      quotaCached: quota as unknown as Prisma.InputJsonValue,
      quotaCheckedAt: new Date(),
      cooldownUntil,
    },
  });

  return quota;
}

/**
 * Fetch quota for all connections of a provider.
 */
export async function refreshAllConnectionsQuota(
  providerId: OAuthProviderId
): Promise<Record<string, ProviderQuotaResult>> {
  const gw = await getOrCreateOAuthGateway(providerId);
  const connections = await db.providerConnection.findMany({
    where: { gatewayId: gw.id },
    select: { id: true },
  });

  const results: Record<string, ProviderQuotaResult> = {};
  for (const c of connections) {
    try {
      results[c.id.toString()] = await refreshSingleConnectionQuota(c.id, providerId);
    } catch (e: unknown) {
      results[c.id.toString()] = {
        supported: true,
        exhausted: false,
        quotas: {},
        message: e instanceof Error ? e.message : "Refresh failed",
      };
    }
  }

  return results;
}
