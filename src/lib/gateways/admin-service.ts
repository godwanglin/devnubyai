import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { encryptSecret } from "@/lib/crypto/vault";
import { validateSafeUrlResolved } from "@/lib/tools/ssrf";
import { recordAdminAudit } from "@/lib/admin/audit";
import { bumpRoutingVersion } from "@/lib/routing/settings";
import type { Prisma } from "@/generated/client";

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createGatewaySchema = z.object({
  slug: z.string().trim().min(2).max(64).regex(SLUG_REGEX, "Slug must be lowercase alphanumeric with optional single hyphens"),
  name: z.string().trim().min(1).max(120),
  baseUrl: z.string().trim().url(),
  wireApi: z.enum(["chat", "responses"]).default("chat"),
  modelsPath: z.string().trim().startsWith("/").max(255).default("/models"),
  apiKey: z.string().trim().min(1, "API key is required"),
  extraHeaders: z.record(z.string(), z.string()).optional().nullable(),
  isPrimary: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
  priority: z.number().int().min(1).max(65535).default(100),
  timeoutMs: z.number().int().min(1000).max(600000).default(120000),
  firstTokenTimeoutMs: z.number().int().min(1000).max(120000).default(20000),
});

export const updateGatewaySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  baseUrl: z.string().trim().url().optional(),
  wireApi: z.enum(["chat", "responses"]).optional(),
  modelsPath: z.string().trim().startsWith("/").max(255).optional(),
  apiKey: z.string().trim().min(1).optional(),
  extraHeaders: z.record(z.string(), z.string()).optional().nullable(),
  isPrimary: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
  priority: z.number().int().min(1).max(65535).optional(),
  timeoutMs: z.number().int().min(1000).max(600000).optional(),
  firstTokenTimeoutMs: z.number().int().min(1000).max(120000).optional(),
});

export type CreateGatewayInput = z.infer<typeof createGatewaySchema>;
export type UpdateGatewayInput = z.infer<typeof updateGatewaySchema>;

export interface SanitizedGatewayDto {
  id: string;
  slug: string;
  name: string;
  baseUrl: string;
  wireApi: "chat" | "responses";
  modelsPath: string;
  apiKeyLast4: string | null;
  extraHeaders: Record<string, string> | null;
  isPrimary: boolean;
  isEnabled: boolean;
  priority: number;
  timeoutMs: number;
  firstTokenTimeoutMs: number;
  healthStatus: string;
  consecutiveFailures: number;
  circuitOpenUntil: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  authType: "api_key" | "oauth";
  oauthProvider: string | null;
}

export function sanitizeGateway(g: {
  authType?: string | null;
  oauthProvider?: string | null;
  id: bigint;
  slug: string;
  name: string;
  baseUrl: string;
  wireApi: string;
  modelsPath: string;
  apiKeyLast4: string | null;
  extraHeaders: unknown;
  isPrimary: boolean;
  isEnabled: boolean;
  priority: number;
  timeoutMs: number;
  firstTokenTimeoutMs: number;
  healthStatus: string;
  consecutiveFailures: number;
  circuitOpenUntil: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): SanitizedGatewayDto {
  let parsedHeaders: Record<string, string> | null = null;
  if (g.extraHeaders && typeof g.extraHeaders === "object" && !Array.isArray(g.extraHeaders)) {
    const raw = g.extraHeaders as Record<string, unknown>;
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string") clean[k] = v;
    }
    if (Object.keys(clean).length > 0) parsedHeaders = clean;
  }

  return {
    id: g.id.toString(),
    slug: g.slug,
    name: g.name,
    baseUrl: g.baseUrl,
    wireApi: g.wireApi === "responses" ? "responses" : "chat",
    modelsPath: g.modelsPath,
    apiKeyLast4: g.apiKeyLast4,
    extraHeaders: parsedHeaders,
    isPrimary: Boolean(g.isPrimary),
    isEnabled: Boolean(g.isEnabled),
    priority: g.priority,
    timeoutMs: g.timeoutMs,
    firstTokenTimeoutMs: g.firstTokenTimeoutMs,
    healthStatus: g.healthStatus,
    consecutiveFailures: g.consecutiveFailures,
    circuitOpenUntil: g.circuitOpenUntil?.toISOString() ?? null,
    lastSuccessAt: g.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: g.lastFailureAt?.toISOString() ?? null,
    lastSyncedAt: g.lastSyncedAt?.toISOString() ?? null,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
    authType: g.authType === "oauth" ? "oauth" : "api_key",
    oauthProvider: g.oauthProvider ?? null,
  };
}

export async function listSanitizedGateways(options?: { includeOAuth?: boolean }): Promise<SanitizedGatewayDto[]> {
  const where: Prisma.GatewayWhereInput = {};
  if (!options?.includeOAuth) {
    where.authType = "api_key";
  }

  const gateways = await db.gateway.findMany({
    where,
    orderBy: [{ priority: "asc" }, { id: "asc" }],
  });
  return gateways.map(sanitizeGateway);
}

export async function getSanitizedGateway(id: bigint): Promise<SanitizedGatewayDto> {
  const gateway = await db.gateway.findUnique({
    where: { id },
  });
  if (!gateway) {
    throw ApiError.notFound("Gateway not found");
  }
  return sanitizeGateway(gateway);
}

export async function createAdminGateway(
  input: CreateGatewayInput,
  actorUserId: bigint
): Promise<SanitizedGatewayDto> {
  const ssrfCheck = await validateSafeUrlResolved(input.baseUrl);
  if (!ssrfCheck.safe) {
    throw ApiError.badRequest(`Unsafe baseUrl: ${ssrfCheck.reason}`);
  }

  const existingSlug = await db.gateway.findUnique({
    where: { slug: input.slug },
    select: { id: true },
  });
  if (existingSlug) {
    throw ApiError.conflict(`Gateway with slug '${input.slug}' already exists`);
  }

  const apiKeyCiphertext = encryptSecret(input.apiKey);
  const apiKeyLast4 = input.apiKey.slice(-4);
  const cleanBaseUrl = input.baseUrl.replace(/\/+$/, "");

  const result = await db.$transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.gateway.updateMany({
        where: { isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const created = await tx.gateway.create({
      data: {
        slug: input.slug,
        name: input.name,
        baseUrl: cleanBaseUrl,
        wireApi: input.wireApi,
        modelsPath: input.modelsPath,
        apiKeyCiphertext,
        apiKeyLast4,
        extraHeaders: (input.extraHeaders ?? undefined) as Prisma.InputJsonValue | undefined,
        isPrimary: input.isPrimary,
        isEnabled: input.isEnabled,
        priority: input.priority,
        timeoutMs: input.timeoutMs,
        firstTokenTimeoutMs: input.firstTokenTimeoutMs,
      },
    });

    const sanitized = sanitizeGateway(created);
    await recordAdminAudit(
      {
        actorUserId,
        action: "gateway.create",
        entityType: "gateway",
        entityId: sanitized.id,
        afterState: sanitized as unknown as Record<string, unknown>,
      },
      tx
    );

    await bumpRoutingVersion(actorUserId, tx);
    return sanitized;
  });

  return result;
}

export async function updateAdminGateway(
  id: bigint,
  input: UpdateGatewayInput,
  actorUserId: bigint
): Promise<SanitizedGatewayDto> {
  const existing = await db.gateway.findUnique({
    where: { id },
  });
  if (!existing) {
    throw ApiError.notFound("Gateway not found");
  }

  if (input.baseUrl) {
    const ssrfCheck = await validateSafeUrlResolved(input.baseUrl);
    if (!ssrfCheck.safe) {
      throw ApiError.badRequest(`Unsafe baseUrl: ${ssrfCheck.reason}`);
    }
  }

  const beforeSanitized = sanitizeGateway(existing);
  const dataToUpdate: Prisma.GatewayUpdateInput = {};

  if (input.name !== undefined) dataToUpdate.name = input.name;
  if (input.baseUrl !== undefined) dataToUpdate.baseUrl = input.baseUrl.replace(/\/+$/, "");
  if (input.wireApi !== undefined) dataToUpdate.wireApi = input.wireApi;
  if (input.modelsPath !== undefined) dataToUpdate.modelsPath = input.modelsPath;
  if (input.extraHeaders !== undefined) {
    dataToUpdate.extraHeaders = (input.extraHeaders ?? null) as Prisma.InputJsonValue;
  }
  if (input.isEnabled !== undefined) dataToUpdate.isEnabled = input.isEnabled;
  if (input.priority !== undefined) dataToUpdate.priority = input.priority;
  if (input.timeoutMs !== undefined) dataToUpdate.timeoutMs = input.timeoutMs;
  if (input.firstTokenTimeoutMs !== undefined) {
    dataToUpdate.firstTokenTimeoutMs = input.firstTokenTimeoutMs;
  }
  if (input.isPrimary !== undefined) dataToUpdate.isPrimary = input.isPrimary;

  if (input.apiKey) {
    dataToUpdate.apiKeyCiphertext = encryptSecret(input.apiKey);
    dataToUpdate.apiKeyLast4 = input.apiKey.slice(-4);
  }

  const result = await db.$transaction(async (tx) => {
    if (input.isPrimary === true && !existing.isPrimary) {
      await tx.gateway.updateMany({
        where: { isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const updated = await tx.gateway.update({
      where: { id },
      data: dataToUpdate,
    });

    const afterSanitized = sanitizeGateway(updated);
    await recordAdminAudit(
      {
        actorUserId,
        action: "gateway.update",
        entityType: "gateway",
        entityId: id.toString(),
        beforeState: beforeSanitized as unknown as Record<string, unknown>,
        afterState: afterSanitized as unknown as Record<string, unknown>,
      },
      tx
    );

    await bumpRoutingVersion(actorUserId, tx);
    return afterSanitized;
  });

  return result;
}

export async function setPrimaryAdminGateway(
  id: bigint,
  actorUserId: bigint
): Promise<SanitizedGatewayDto> {
  const target = await db.gateway.findUnique({
    where: { id },
  });
  if (!target) {
    throw ApiError.notFound("Gateway not found");
  }

  const beforeSanitized = sanitizeGateway(target);

  const result = await db.$transaction(async (tx) => {
    await tx.gateway.updateMany({
      where: { isPrimary: true },
      data: { isPrimary: false },
    });

    const updated = await tx.gateway.update({
      where: { id },
      data: { isPrimary: true },
    });

    const afterSanitized = sanitizeGateway(updated);
    await recordAdminAudit(
      {
        actorUserId,
        action: "gateway.set_primary",
        entityType: "gateway",
        entityId: id.toString(),
        beforeState: beforeSanitized as unknown as Record<string, unknown>,
        afterState: afterSanitized as unknown as Record<string, unknown>,
      },
      tx
    );

    await bumpRoutingVersion(actorUserId, tx);
    return afterSanitized;
  });

  return result;
}

export async function deleteAdminGateway(
  id: bigint,
  actorUserId: bigint
): Promise<{ id: string; deleted: boolean }> {
  const existing = await db.gateway.findUnique({
    where: { id },
  });
  if (!existing) {
    throw ApiError.notFound("Gateway not found");
  }

  if (existing.isPrimary) {
    throw ApiError.badRequest("Cannot delete the primary gateway. Set another primary first.");
  }

  const activeRoutes = await db.catalogModelRoute.count({
    where: {
      isEnabled: true,
      upstreamModel: {
        gatewayId: id,
      },
    },
  });

  if (activeRoutes > 0) {
    throw ApiError.conflict(
      `Cannot delete gateway: it is referenced by ${activeRoutes} active catalog route(s). Disable or reassign those routes first.`
    );
  }

  const beforeSanitized = sanitizeGateway(existing);

  await db.$transaction(async (tx) => {
    await tx.gateway.delete({
      where: { id },
    });

    await recordAdminAudit(
      {
        actorUserId,
        action: "gateway.delete",
        entityType: "gateway",
        entityId: id.toString(),
        beforeState: beforeSanitized as unknown as Record<string, unknown>,
      },
      tx
    );

    await bumpRoutingVersion(actorUserId, tx);
  });

  return { id: id.toString(), deleted: true };
}

export async function resetGatewayCircuit(
  id: bigint,
  actorUserId: bigint
): Promise<SanitizedGatewayDto> {
  const existing = await db.gateway.findUnique({
    where: { id },
  });
  if (!existing) {
    throw ApiError.notFound("Gateway not found");
  }

  const beforeSanitized = sanitizeGateway(existing);

  const result = await db.$transaction(async (tx) => {
    const updated = await tx.gateway.update({
      where: { id },
      data: {
        consecutiveFailures: 0,
        circuitOpenUntil: null,
        healthStatus: "unknown",
      },
    });

    const afterSanitized = sanitizeGateway(updated);
    await recordAdminAudit(
      {
        actorUserId,
        action: "gateway.reset_circuit",
        entityType: "gateway",
        entityId: id.toString(),
        beforeState: beforeSanitized as unknown as Record<string, unknown>,
        afterState: afterSanitized as unknown as Record<string, unknown>,
      },
      tx
    );

    await bumpRoutingVersion(actorUserId, tx);
    return afterSanitized;
  });

  return result;
}

export { testGatewayConnectivity, syncGatewayUpstreamModels } from "./gateway-sync";
export type { GatewayTestResult, GatewaySyncResult } from "./gateway-sync";

