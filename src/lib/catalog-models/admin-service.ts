import { z } from "zod";
import { partialUpdate } from "@/lib/api/zod-partial";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { recordAdminAudit } from "@/lib/admin/audit";
import { bumpRoutingVersion } from "@/lib/routing/settings";
import { invalidateActiveCatalogCache } from "@/lib/catalog/cache";
import { ROUTING_STRATEGIES } from "@/lib/routing/strategy";
import type { Prisma } from "@/generated/client";

export interface SanitizedProviderSummaryDto {
  id: string;
  slug: string;
  name: string;
  logoKey: string;
}

export interface SanitizedRouteDto {
  id: string;
  upstreamModelId: string;
  upstreamModelKey: string;
  gatewayId: string;
  gatewayName: string;
  gatewaySlug: string;
  gatewayIsPrimary: boolean;
  gatewayIsEnabled: boolean;
  priority: number;
  weight: number;
  isEnabled: boolean;
  paramOverrides: Record<string, unknown> | null;
}

export interface SanitizedCatalogModelDto {
  id: string;
  publicId: string;
  displayName: string;
  shortName: string;
  description: string | null;
  providerId: string;
  provider: SanitizedProviderSummaryDto;
  category: string;
  badge: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsReasoning: boolean;
  status: string;
  sortOrder: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  pricingCurrency: string;
  routingStrategy: string;
  routeCooldownSeconds: number;
  createdAt: string;
  updatedAt: string;
  routes: SanitizedRouteDto[];
}

export interface UpstreamModelOptionDto {
  id: string;
  modelKey: string;
  ownedBy: string | null;
  isAvailable: boolean;
  gatewayId: string;
  gatewayName: string;
  gatewaySlug: string;
  gatewayIsPrimary: boolean;
  gatewayIsEnabled: boolean;
}

export const routeInputSchema = z.object({
  upstreamModelId: z.string(),
  priority: z.number().int().min(1).max(65535),
  weight: z.number().int().min(1).max(100).default(1),
  isEnabled: z.boolean().default(true),
  paramOverrides: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const createCatalogModelSchema = z.object({
  publicId: z.string().trim().min(2).max(128).regex(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i, "Format public ID harus provider/model-name (misal: openai/gpt-6-luna)"),
  displayName: z.string().trim().min(1).max(120),
  shortName: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).optional().nullable(),
  providerId: z.string(),
  category: z.enum(["powerful", "fast", "balanced", "flagship"]).default("powerful"),
  badge: z.string().trim().max(32).optional().nullable(),
  contextWindow: z.number().int().positive().optional().nullable(),
  maxOutputTokens: z.number().int().positive().optional().nullable(),
  supportsVision: z.boolean().default(false),
  supportsTools: z.boolean().default(false),
  supportsReasoning: z.boolean().default(false),
  inputPricePerMillion: z.number().finite().min(0).max(1000000).default(0),
  outputPricePerMillion: z.number().finite().min(0).max(1000000).default(0),
  pricingCurrency: z.string().trim().length(3).default("USD"),
  status: z.enum(["active", "draft", "deprecated"]).default("active"),
  sortOrder: z.number().int().min(0).max(65535).default(100),
  routingStrategy: z.enum(ROUTING_STRATEGIES).default("priority"),
  routeCooldownSeconds: z.number().int().min(0).max(3600).default(30),
  routes: z.array(routeInputSchema).default([]),
});

export const updateCatalogModelSchema = partialUpdate(createCatalogModelSchema);

export type CreateCatalogModelInput = z.infer<typeof createCatalogModelSchema>;
export type UpdateCatalogModelInput = z.infer<typeof updateCatalogModelSchema>;

export async function listModelProviders(): Promise<SanitizedProviderSummaryDto[]> {
  const providers = await db.modelProvider.findMany({
    orderBy: { sortOrder: "asc" },
  });
  return providers.map((p) => ({
    id: p.id.toString(),
    slug: p.slug,
    name: p.name,
    logoKey: p.logoKey,
  }));
}

export async function listUpstreamOptions(): Promise<UpstreamModelOptionDto[]> {
  const models = await db.upstreamModel.findMany({
    where: {
      gateway: { isEnabled: true },
    },
    include: {
      gateway: {
        select: {
          id: true,
          name: true,
          slug: true,
          isPrimary: true,
          isEnabled: true,
        },
      },
    },
    orderBy: [
      { gateway: { priority: "asc" } },
      { gateway: { name: "asc" } },
      { modelKey: "asc" },
    ],
  });

  return models.map((m) => ({
    id: m.id.toString(),
    modelKey: m.modelKey,
    ownedBy: m.ownedBy,
    isAvailable: Boolean(m.isAvailable),
    gatewayId: m.gateway.id.toString(),
    gatewayName: m.gateway.name,
    gatewaySlug: m.gateway.slug,
    gatewayIsPrimary: Boolean(m.gateway.isPrimary),
    gatewayIsEnabled: Boolean(m.gateway.isEnabled),
  }));
}

export async function listCatalogModelsAdmin(query?: {
  search?: string;
  status?: string;
  providerId?: string;
}): Promise<SanitizedCatalogModelDto[]> {
  const where: Prisma.CatalogModelWhereInput = {};

  if (query?.status && query.status !== "all") {
    where.status = query.status;
  }
  if (query?.providerId && query.providerId !== "all") {
    try {
      where.providerId = BigInt(query.providerId);
    } catch {
      throw ApiError.badRequest("Invalid providerId");
    }
  }
  if (query?.search && query.search.trim().length > 0) {
    const q = query.search.trim();
    where.OR = [
      { publicId: { contains: q } },
      { displayName: { contains: q } },
      { shortName: { contains: q } },
    ];
  }

  const models = await db.catalogModel.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { displayName: "asc" }],
    include: {
      provider: true,
      routes: {
        orderBy: { priority: "asc" },
        include: {
          upstreamModel: {
            include: {
              gateway: true,
            },
          },
        },
      },
    },
  });

  return models.map(mapCatalogModelToDto);
}

export async function getCatalogModelDetailAdmin(id: bigint): Promise<SanitizedCatalogModelDto> {
  const model = await db.catalogModel.findUnique({
    where: { id },
    include: {
      provider: true,
      routes: {
        orderBy: { priority: "asc" },
        include: {
          upstreamModel: {
            include: {
              gateway: true,
            },
          },
        },
      },
    },
  });

  if (!model) {
    throw ApiError.notFound("Catalog model not found");
  }

  return mapCatalogModelToDto(model);
}

export async function createCatalogModel(
  input: CreateCatalogModelInput,
  actorUserId: bigint
): Promise<SanitizedCatalogModelDto> {
  let providerId: bigint;
  try {
    providerId = BigInt(input.providerId);
  } catch {
    throw ApiError.badRequest("Invalid providerId");
  }

  const existing = await db.catalogModel.findUnique({
    where: { publicId: input.publicId },
  });
  if (existing) {
    throw ApiError.conflict(`Model with public ID '${input.publicId}' already exists`);
  }

  // Validate upstream model IDs
  const parsedRoutes: Array<{
    upstreamModelId: bigint;
    priority: number;
    weight: number;
    isEnabled: boolean;
    paramOverrides: Prisma.InputJsonValue | undefined;
  }> = [];

  const seenUpstreamIds = new Set<string>();
  for (const r of input.routes ?? []) {
    if (seenUpstreamIds.has(r.upstreamModelId)) {
      throw ApiError.badRequest("Duplicate upstream model in routing configuration");
    }
    seenUpstreamIds.add(r.upstreamModelId);

    try {
      parsedRoutes.push({
        upstreamModelId: BigInt(r.upstreamModelId),
        priority: r.priority,
        weight: r.weight,
        isEnabled: r.isEnabled,
        paramOverrides: r.paramOverrides ? (r.paramOverrides as Prisma.InputJsonValue) : undefined,
      });
    } catch {
      throw ApiError.badRequest(`Invalid upstream model ID: ${r.upstreamModelId}`);
    }
  }

  const created = await db.$transaction(async (tx) => {
    const model = await tx.catalogModel.create({
      data: {
        publicId: input.publicId,
        displayName: input.displayName,
        shortName: input.shortName,
        description: input.description ?? null,
        providerId,
        category: input.category,
        badge: input.badge ?? null,
        contextWindow: input.contextWindow ?? null,
        maxOutputTokens: input.maxOutputTokens ?? null,
        supportsVision: input.supportsVision,
        supportsTools: input.supportsTools,
        supportsReasoning: input.supportsReasoning,
        inputPricePerMillion: input.inputPricePerMillion,
        outputPricePerMillion: input.outputPricePerMillion,
        pricingCurrency: input.pricingCurrency,
        status: input.status,
        sortOrder: input.sortOrder,
        routingStrategy: input.routingStrategy,
        routeCooldownSeconds: input.routeCooldownSeconds,
      },
    });

    if (parsedRoutes.length > 0) {
      for (const r of parsedRoutes) {
        await tx.catalogModelRoute.create({
          data: {
            catalogModelId: model.id,
            upstreamModelId: r.upstreamModelId,
            priority: r.priority,
            weight: r.weight,
            isEnabled: r.isEnabled,
            paramOverrides: r.paramOverrides,
          },
        });
      }
    }

    await recordAdminAudit(
      {
        actorUserId,
        action: "catalog_model.create",
        entityType: "catalog_model",
        entityId: model.id.toString(),
        afterState: {
          publicId: model.publicId,
          displayName: model.displayName,
          routesCount: parsedRoutes.length,
          routingStrategy: model.routingStrategy,
          status: model.status,
        },
      },
      tx
    );

    await bumpRoutingVersion(actorUserId, tx);

    return tx.catalogModel.findUniqueOrThrow({
      where: { id: model.id },
      include: {
        provider: true,
        routes: {
          orderBy: { priority: "asc" },
          include: {
            upstreamModel: {
              include: {
                gateway: true,
              },
            },
          },
        },
      },
    });
  });

  await invalidateActiveCatalogCache();
  return mapCatalogModelToDto(created);
}

export async function updateCatalogModel(
  id: bigint,
  input: UpdateCatalogModelInput,
  actorUserId: bigint
): Promise<SanitizedCatalogModelDto> {
  const existing = await db.catalogModel.findUnique({
    where: { id },
    include: {
      routes: true,
    },
  });

  if (!existing) {
    throw ApiError.notFound("Catalog model not found");
  }

  let providerId: bigint | undefined;
  if (input.providerId) {
    try {
      providerId = BigInt(input.providerId);
    } catch {
      throw ApiError.badRequest("Invalid providerId");
    }
  }

  if (input.publicId && input.publicId !== existing.publicId) {
    const conflict = await db.catalogModel.findUnique({
      where: { publicId: input.publicId },
    });
    if (conflict) {
      throw ApiError.conflict(`Public ID '${input.publicId}' is already used`);
    }
  }

  const updated = await db.$transaction(async (tx) => {
    const model = await tx.catalogModel.update({
      where: { id },
      data: {
        publicId: input.publicId,
        displayName: input.displayName,
        shortName: input.shortName,
        description: input.description,
        providerId,
        category: input.category,
        badge: input.badge,
        contextWindow: input.contextWindow,
        maxOutputTokens: input.maxOutputTokens,
        supportsVision: input.supportsVision,
        supportsTools: input.supportsTools,
        supportsReasoning: input.supportsReasoning,
        inputPricePerMillion: input.inputPricePerMillion !== undefined ? input.inputPricePerMillion : existing.inputPricePerMillion,
        outputPricePerMillion: input.outputPricePerMillion !== undefined ? input.outputPricePerMillion : existing.outputPricePerMillion,
        pricingCurrency: input.pricingCurrency !== undefined ? input.pricingCurrency : existing.pricingCurrency,
        status: input.status,
        sortOrder: input.sortOrder,
        routingStrategy: input.routingStrategy,
        routeCooldownSeconds: input.routeCooldownSeconds,
      },
    });

    if (input.routes !== undefined) {
      // Replace routes with new set
      await tx.catalogModelRoute.deleteMany({
        where: { catalogModelId: id },
      });

      const seenUpstream = new Set<string>();
      for (const r of input.routes) {
        if (seenUpstream.has(r.upstreamModelId)) {
          throw ApiError.badRequest("Duplicate upstream model in routing configuration");
        }
        seenUpstream.add(r.upstreamModelId);

        let upstreamModelId: bigint;
        try {
          upstreamModelId = BigInt(r.upstreamModelId);
        } catch {
          throw ApiError.badRequest(`Invalid upstream model ID: ${r.upstreamModelId}`);
        }

        await tx.catalogModelRoute.create({
          data: {
            catalogModelId: id,
            upstreamModelId,
            priority: r.priority,
            weight: r.weight,
            isEnabled: r.isEnabled,
            paramOverrides: r.paramOverrides ? (r.paramOverrides as Prisma.InputJsonValue) : undefined,
          },
        });
      }
    }

    await recordAdminAudit(
      {
        actorUserId,
        action: "catalog_model.update",
        entityType: "catalog_model",
        entityId: id.toString(),
        beforeState: {
          publicId: existing.publicId,
          displayName: existing.displayName,
          status: existing.status,
          routingStrategy: existing.routingStrategy,
        },
        afterState: {
          publicId: model.publicId,
          displayName: model.displayName,
          status: model.status,
          routingStrategy: model.routingStrategy,
        },
      },
      tx
    );

    await bumpRoutingVersion(actorUserId, tx);

    return tx.catalogModel.findUniqueOrThrow({
      where: { id },
      include: {
        provider: true,
        routes: {
          orderBy: { priority: "asc" },
          include: {
            upstreamModel: {
              include: {
                gateway: true,
              },
            },
          },
        },
      },
    });
  });

  await invalidateActiveCatalogCache();
  return mapCatalogModelToDto(updated);
}

export async function deleteCatalogModel(id: bigint, actorUserId: bigint): Promise<void> {
  const existing = await db.catalogModel.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          chatSessions: true,
          chatMessages: true,
        },
      },
    },
  });

  if (!existing) {
    throw ApiError.notFound("Catalog model not found");
  }

  await db.$transaction(async (tx) => {
    // If sessions or messages reference it, soft-archive (set status to deprecated) to prevent foreign key errors
    if (existing._count.chatSessions > 0 || existing._count.chatMessages > 0) {
      await tx.catalogModel.update({
        where: { id },
        data: { status: "deprecated" },
      });
      await tx.catalogModelRoute.updateMany({
        where: { catalogModelId: id },
        data: { isEnabled: false },
      });
    } else {
      await tx.catalogModelRoute.deleteMany({
        where: { catalogModelId: id },
      });
      await tx.catalogModel.delete({
        where: { id },
      });
    }

    await recordAdminAudit(
      {
        actorUserId,
        action: "catalog_model.delete",
        entityType: "catalog_model",
        entityId: id.toString(),
        beforeState: {
          publicId: existing.publicId,
          displayName: existing.displayName,
        },
      },
      tx
    );

    await bumpRoutingVersion(actorUserId, tx);
  });

  await invalidateActiveCatalogCache();
}

function mapCatalogModelToDto(
  model: Prisma.CatalogModelGetPayload<{
    include: {
      provider: true;
      routes: {
        include: {
          upstreamModel: {
            include: {
              gateway: true;
            };
          };
        };
      };
    };
  }>
): SanitizedCatalogModelDto {
  return {
    id: model.id.toString(),
    publicId: model.publicId,
    displayName: model.displayName,
    shortName: model.shortName,
    description: model.description,
    providerId: model.providerId.toString(),
    provider: {
      id: model.provider.id.toString(),
      slug: model.provider.slug,
      name: model.provider.name,
      logoKey: model.provider.logoKey,
    },
    category: model.category,
    badge: model.badge,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    supportsVision: Boolean(model.supportsVision),
    supportsTools: Boolean(model.supportsTools),
    supportsReasoning: Boolean(model.supportsReasoning),
    status: model.status,
    sortOrder: model.sortOrder,
    inputPricePerMillion: Number(model.inputPricePerMillion),
    outputPricePerMillion: Number(model.outputPricePerMillion),
    pricingCurrency: model.pricingCurrency,
    routingStrategy: model.routingStrategy,
    routeCooldownSeconds: model.routeCooldownSeconds,
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString(),
    routes: model.routes.map((r) => ({
      id: r.id.toString(),
      upstreamModelId: r.upstreamModelId.toString(),
      upstreamModelKey: r.upstreamModel.modelKey,
      gatewayId: r.upstreamModel.gateway.id.toString(),
      gatewayName: r.upstreamModel.gateway.name,
      gatewaySlug: r.upstreamModel.gateway.slug,
      gatewayIsPrimary: Boolean(r.upstreamModel.gateway.isPrimary),
      gatewayIsEnabled: Boolean(r.upstreamModel.gateway.isEnabled),
      priority: r.priority,
      weight: r.weight,
      isEnabled: Boolean(r.isEnabled),
      paramOverrides: r.paramOverrides && typeof r.paramOverrides === "object" ? (r.paramOverrides as Record<string, unknown>) : null,
    })),
  };
}
