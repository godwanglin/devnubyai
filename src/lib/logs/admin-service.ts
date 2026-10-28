import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/client";

export interface SanitizedAuditLogDto {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  beforeState: unknown | null;
  afterState: unknown | null;
  createdAt: string;
}

export interface SanitizedRoutingAttemptDto {
  id: string;
  requestId: string;
  userId: string | null;
  messageId: string | null;
  catalogModelId: string;
  catalogModelName?: string;
  catalogModelPublicId?: string;
  gatewayId: string;
  gatewayName?: string;
  gatewaySlug?: string;
  upstreamModelId: string;
  attemptNo: number;
  outcome: string;
  errorClass: string | null;
  httpStatus: number | null;
  latencyMs: number;
  ttftMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  createdAt: string;
}

export const auditLogsQuerySchema = z.object({
  entityType: z.string().optional(),
  action: z.string().optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export type AuditLogsQuery = z.infer<typeof auditLogsQuerySchema>;

export async function listAdminAuditLogs(query: AuditLogsQuery) {
  const where: Prisma.AdminAuditLogWhereInput = {};

  if (query.entityType && query.entityType !== "all") {
    where.entityType = query.entityType;
  }
  if (query.action && query.action !== "all") {
    where.action = { contains: query.action };
  }
  if (query.search && query.search.trim().length > 0) {
    const q = query.search.trim();
    where.OR = [
      { action: { contains: q } },
      { entityId: { contains: q } },
      { entityType: { contains: q } },
    ];
  }

  const skip = (query.page - 1) * query.pageSize;
  const take = query.pageSize;

  const [total, logs] = await Promise.all([
    db.adminAuditLog.count({ where }),
    db.adminAuditLog.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    }),
  ]);

  const items: SanitizedAuditLogDto[] = logs.map((log) => ({
    id: log.id.toString(),
    actorUserId: log.actorUserId ? log.actorUserId.toString() : null,
    actorName: log.actor?.name ?? null,
    actorEmail: log.actor?.email ?? null,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    beforeState: log.beforeState,
    afterState: log.afterState,
    createdAt: log.createdAt.toISOString(),
  }));

  return {
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(total / query.pageSize) || 1,
  };
}

export const routingAttemptsQuerySchema = z.object({
  outcome: z.string().optional(),
  gatewayId: z.string().optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export type RoutingAttemptsQuery = z.infer<typeof routingAttemptsQuerySchema>;

export async function listRoutingAttempts(query: RoutingAttemptsQuery) {
  const where: Prisma.RoutingAttemptWhereInput = {};

  if (query.outcome && query.outcome !== "all") {
    where.outcome = query.outcome;
  }
  if (query.gatewayId && query.gatewayId !== "all") {
    try {
      where.gatewayId = BigInt(query.gatewayId);
    } catch {
      // Ignore invalid gateway ID
    }
  }
  if (query.search && query.search.trim().length > 0) {
    const q = query.search.trim();
    where.OR = [
      { requestId: { contains: q } },
      { errorClass: { contains: q } },
    ];
  }

  const skip = (query.page - 1) * query.pageSize;
  const take = query.pageSize;

  const [total, attempts] = await Promise.all([
    db.routingAttempt.count({ where }),
    db.routingAttempt.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Bulk load gateway & model metadata in memory to avoid full table scans/joins on unconstrained tables
  const gatewayIds = Array.from(new Set(attempts.map((a) => a.gatewayId)));
  const modelIds = Array.from(new Set(attempts.map((a) => a.catalogModelId)));

  const [gateways, catalogModels] = await Promise.all([
    gatewayIds.length > 0
      ? db.gateway.findMany({
          where: { id: { in: gatewayIds } },
          select: { id: true, name: true, slug: true },
        })
      : [],
    modelIds.length > 0
      ? db.catalogModel.findMany({
          where: { id: { in: modelIds } },
          select: { id: true, displayName: true, publicId: true },
        })
      : [],
  ]);

  const gatewayMap = new Map(gateways.map((g) => [g.id.toString(), g]));
  const modelMap = new Map(catalogModels.map((m) => [m.id.toString(), m]));

  const items: SanitizedRoutingAttemptDto[] = attempts.map((a) => {
    const gw = gatewayMap.get(a.gatewayId.toString());
    const m = modelMap.get(a.catalogModelId.toString());

    return {
      id: a.id.toString(),
      requestId: a.requestId,
      userId: a.userId ? a.userId.toString() : null,
      messageId: a.messageId ? a.messageId.toString() : null,
      catalogModelId: a.catalogModelId.toString(),
      catalogModelName: m?.displayName,
      catalogModelPublicId: m?.publicId,
      gatewayId: a.gatewayId.toString(),
      gatewayName: gw?.name,
      gatewaySlug: gw?.slug,
      upstreamModelId: a.upstreamModelId.toString(),
      attemptNo: a.attemptNo,
      outcome: a.outcome,
      errorClass: a.errorClass,
      httpStatus: a.httpStatus,
      latencyMs: a.latencyMs,
      ttftMs: a.ttftMs,
      promptTokens: a.promptTokens,
      completionTokens: a.completionTokens,
      createdAt: a.createdAt.toISOString(),
    };
  });

  return {
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(total / query.pageSize) || 1,
  };
}
