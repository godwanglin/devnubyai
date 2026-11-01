import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { recordAdminAudit } from "@/lib/admin/audit";
import { bumpRoutingVersion } from "@/lib/routing/settings";
import type { Prisma } from "@/generated/client";

export interface SanitizedGatewaySummaryDto {
  id: string;
  name: string;
  slug: string;
  isEnabled: boolean;
  healthStatus: string;
}

export interface SanitizedUpstreamModelDto {
  id: string;
  gatewayId: string;
  modelKey: string;
  ownedBy: string | null;
  isAvailable: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
  routesCount: number;
  gateway: SanitizedGatewaySummaryDto;
}

export interface SanitizedLinkedRouteDto {
  id: string;
  priority: number;
  isEnabled: boolean;
  catalogModel: {
    id: string;
    publicId: string;
    displayName: string;
    status: string;
  };
}

export interface SanitizedUpstreamModelDetailDto extends SanitizedUpstreamModelDto {
  rawMetadata: unknown | null;
  routes: SanitizedLinkedRouteDto[];
}

export const listUpstreamModelsQuerySchema = z.object({
  gatewayId: z.string().optional(),
  search: z.string().trim().optional(),
  available: z.enum(["all", "true", "false"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListUpstreamModelsQuery = z.infer<typeof listUpstreamModelsQuerySchema>;

export interface ListUpstreamModelsResult {
  items: SanitizedUpstreamModelDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listSanitizedUpstreamModels(
  query: ListUpstreamModelsQuery
): Promise<ListUpstreamModelsResult> {
  const where: Prisma.UpstreamModelWhereInput = {};

  if (query.gatewayId) {
    try {
      where.gatewayId = BigInt(query.gatewayId);
    } catch {
      throw ApiError.badRequest("Invalid gatewayId");
    }
  }

  if (query.available === "true") {
    where.isAvailable = true;
  } else if (query.available === "false") {
    where.isAvailable = false;
  }

  if (query.search && query.search.length > 0) {
    where.OR = [
      { modelKey: { contains: query.search } },
      { ownedBy: { contains: query.search } },
    ];
  }

  const skip = (query.page - 1) * query.pageSize;
  const take = query.pageSize;

  const [total, models] = await Promise.all([
    db.upstreamModel.count({ where }),
    db.upstreamModel.findMany({
      where,
      skip,
      take,
      orderBy: [
        { isAvailable: "desc" },
        { modelKey: "asc" },
      ],
      select: {
        id: true,
        gatewayId: true,
        modelKey: true,
        ownedBy: true,
        isAvailable: true,
        firstSeenAt: true,
        lastSeenAt: true,
        createdAt: true,
        updatedAt: true,
        gateway: {
          select: {
            id: true,
            name: true,
            slug: true,
            isEnabled: true,
            healthStatus: true,
          },
        },
        _count: {
          select: {
            routes: true,
          },
        },
      },
    }),
  ]);

  const items: SanitizedUpstreamModelDto[] = models.map((m) => ({
    id: m.id.toString(),
    gatewayId: m.gatewayId.toString(),
    modelKey: m.modelKey,
    ownedBy: m.ownedBy,
    isAvailable: Boolean(m.isAvailable),
    firstSeenAt: m.firstSeenAt.toISOString(),
    lastSeenAt: m.lastSeenAt.toISOString(),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    routesCount: m._count.routes,
    gateway: {
      id: m.gateway.id.toString(),
      name: m.gateway.name,
      slug: m.gateway.slug,
      isEnabled: Boolean(m.gateway.isEnabled),
      healthStatus: m.gateway.healthStatus,
    },
  }));

  const totalPages = Math.ceil(total / query.pageSize) || 1;

  return {
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages,
  };
}

export async function getSanitizedUpstreamModel(
  id: bigint
): Promise<SanitizedUpstreamModelDetailDto> {
  const model = await db.upstreamModel.findUnique({
    where: { id },
    include: {
      gateway: {
        select: {
          id: true,
          name: true,
          slug: true,
          isEnabled: true,
          healthStatus: true,
        },
      },
      routes: {
        select: {
          id: true,
          priority: true,
          isEnabled: true,
          catalogModel: {
            select: {
              id: true,
              publicId: true,
              displayName: true,
              status: true,
            },
          },
        },
        orderBy: {
          priority: "asc",
        },
      },
    },
  });

  if (!model) {
    throw ApiError.notFound("Upstream model not found");
  }

  return {
    id: model.id.toString(),
    gatewayId: model.gatewayId.toString(),
    modelKey: model.modelKey,
    ownedBy: model.ownedBy,
    isAvailable: Boolean(model.isAvailable),
    rawMetadata: model.rawMetadata,
    firstSeenAt: model.firstSeenAt.toISOString(),
    lastSeenAt: model.lastSeenAt.toISOString(),
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString(),
    routesCount: model.routes.length,
    gateway: {
      id: model.gateway.id.toString(),
      name: model.gateway.name,
      slug: model.gateway.slug,
      isEnabled: Boolean(model.gateway.isEnabled),
      healthStatus: model.gateway.healthStatus,
    },
    routes: model.routes.map((r) => ({
      id: r.id.toString(),
      priority: r.priority,
      isEnabled: Boolean(r.isEnabled),
      catalogModel: {
        id: r.catalogModel.id.toString(),
        publicId: r.catalogModel.publicId,
        displayName: r.catalogModel.displayName,
        status: r.catalogModel.status,
      },
    })),
  };
}

export const updateUpstreamModelSchema = z.object({
  isAvailable: z.boolean(),
});

export type UpdateUpstreamModelInput = z.infer<typeof updateUpstreamModelSchema>;

export async function toggleUpstreamModelAvailability(
  id: bigint,
  isAvailable: boolean,
  actorUserId: bigint
): Promise<SanitizedUpstreamModelDto> {
  const existing = await db.upstreamModel.findUnique({
    where: { id },
    include: {
      gateway: {
        select: {
          id: true,
          name: true,
          slug: true,
          isEnabled: true,
          healthStatus: true,
        },
      },
      _count: {
        select: { routes: true },
      },
    },
  });

  if (!existing) {
    throw ApiError.notFound("Upstream model not found");
  }

  const updated = await db.$transaction(async (tx) => {
    const res = await tx.upstreamModel.update({
      where: { id },
      data: { isAvailable },
      include: {
        gateway: {
          select: {
            id: true,
            name: true,
            slug: true,
            isEnabled: true,
            healthStatus: true,
          },
        },
        _count: {
          select: { routes: true },
        },
      },
    });

    await recordAdminAudit(
      {
        actorUserId,
        action: "upstream_model.toggle_availability",
        entityType: "upstream_model",
        entityId: id.toString(),
        beforeState: {
          isAvailable: existing.isAvailable,
          modelKey: existing.modelKey,
          gatewayId: existing.gatewayId.toString(),
        },
        afterState: {
          isAvailable: res.isAvailable,
          modelKey: res.modelKey,
          gatewayId: res.gatewayId.toString(),
        },
      },
      tx
    );

    await bumpRoutingVersion(actorUserId, tx);

    return res;
  });

  return {
    id: updated.id.toString(),
    gatewayId: updated.gatewayId.toString(),
    modelKey: updated.modelKey,
    ownedBy: updated.ownedBy,
    isAvailable: Boolean(updated.isAvailable),
    firstSeenAt: updated.firstSeenAt.toISOString(),
    lastSeenAt: updated.lastSeenAt.toISOString(),
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    routesCount: updated._count.routes,
    gateway: {
      id: updated.gateway.id.toString(),
      name: updated.gateway.name,
      slug: updated.gateway.slug,
      isEnabled: Boolean(updated.gateway.isEnabled),
      healthStatus: updated.gateway.healthStatus,
    },
  };
}

export const createUpstreamModelSchema = z.object({
  gatewayId: z.string().min(1, "Gateway is required"),
  modelKey: z.string().trim().min(1, "Model key is required").max(191),
  ownedBy: z.string().trim().max(191).optional().nullable(),
  isAvailable: z.boolean().default(true),
  rawMetadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export type CreateUpstreamModelInput = z.infer<typeof createUpstreamModelSchema>;

export async function createUpstreamModel(
  input: CreateUpstreamModelInput,
  actorUserId: bigint
): Promise<SanitizedUpstreamModelDto> {
  let gatewayId: bigint;
  try {
    gatewayId = BigInt(input.gatewayId);
  } catch {
    throw ApiError.badRequest("Invalid gatewayId");
  }

  const gateway = await db.gateway.findUnique({
    where: { id: gatewayId },
    select: { id: true, name: true, slug: true, isEnabled: true, healthStatus: true },
  });
  if (!gateway) {
    throw ApiError.notFound("Gateway not found");
  }

  const now = new Date();
  const created = await db.$transaction(async (tx) => {
    const model = await tx.upstreamModel.upsert({
      where: {
        gatewayId_modelKey: {
          gatewayId,
          modelKey: input.modelKey,
        },
      },
      create: {
        gatewayId,
        modelKey: input.modelKey,
        ownedBy: input.ownedBy || null,
        isAvailable: input.isAvailable ?? true,
        rawMetadata: (input.rawMetadata as Prisma.InputJsonValue) ?? undefined,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        ownedBy: input.ownedBy || null,
        isAvailable: input.isAvailable ?? true,
        rawMetadata: (input.rawMetadata as Prisma.InputJsonValue) ?? undefined,
        lastSeenAt: now,
      },
      include: {
        gateway: {
          select: {
            id: true,
            name: true,
            slug: true,
            isEnabled: true,
            healthStatus: true,
          },
        },
        _count: {
          select: { routes: true },
        },
      },
    });

    await recordAdminAudit(
      {
        actorUserId,
        action: "upstream_model.create",
        entityType: "upstream_model",
        entityId: model.id.toString(),
        afterState: {
          modelKey: model.modelKey,
          gatewayId: gatewayId.toString(),
          isAvailable: model.isAvailable,
          ownedBy: model.ownedBy,
        },
      },
      tx
    );

    await bumpRoutingVersion(actorUserId, tx);

    return model;
  });

  return {
    id: created.id.toString(),
    gatewayId: created.gatewayId.toString(),
    modelKey: created.modelKey,
    ownedBy: created.ownedBy,
    isAvailable: Boolean(created.isAvailable),
    firstSeenAt: created.firstSeenAt.toISOString(),
    lastSeenAt: created.lastSeenAt.toISOString(),
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
    routesCount: created._count.routes,
    gateway: {
      id: created.gateway.id.toString(),
      name: created.gateway.name,
      slug: created.gateway.slug,
      isEnabled: Boolean(created.gateway.isEnabled),
      healthStatus: created.gateway.healthStatus,
    },
  };
}

export async function deleteUpstreamModel(id: bigint, actorUserId: bigint): Promise<void> {
  const existing = await db.upstreamModel.findUnique({
    where: { id },
    select: { id: true, modelKey: true, gatewayId: true },
  });

  if (!existing) {
    throw ApiError.notFound("Upstream model not found");
  }

  await db.$transaction(async (tx) => {
    await tx.upstreamModel.delete({
      where: { id },
    });

    await recordAdminAudit(
      {
        actorUserId,
        action: "upstream_model.delete",
        entityType: "upstream_model",
        entityId: id.toString(),
        beforeState: {
          modelKey: existing.modelKey,
          gatewayId: existing.gatewayId.toString(),
        },
      },
      tx
    );

    await bumpRoutingVersion(actorUserId, tx);
  });
}
