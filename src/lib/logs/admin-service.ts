import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/client";
import { readLogs } from "@/lib/logger/file-logger";

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
  pageSize: z.coerce.number().int().min(1).max(100).default(15),
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
  date: z.string().optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(15),
});

export type RoutingAttemptsQuery = z.infer<typeof routingAttemptsQuerySchema>;

/**
 * Reads telemetry routing attempts directly from daily file logs (.logs/YYYY-MM-DD.log)
 * without hitting the database.
 */
export async function listRoutingAttempts(query: RoutingAttemptsQuery) {
  const result = await readLogs({
    date: query.date,
    type: "routing",
    search: query.search,
    page: query.page,
    pageSize: query.pageSize,
  });

  // Filter in memory if outcome or gatewayId is provided
  let filteredItems = result.items;
  if (query.outcome && query.outcome !== "all") {
    filteredItems = filteredItems.filter(
      (item) => String(item.data.outcome).toLowerCase() === query.outcome?.toLowerCase()
    );
  }
  if (query.gatewayId && query.gatewayId !== "all") {
    filteredItems = filteredItems.filter(
      (item) => String(item.data.gatewayId) === query.gatewayId
    );
  }

  // Bulk load gateway & model metadata in memory to enrich display labels
  const gatewayIds = Array.from(
    new Set(
      filteredItems
        .map((a) => a.data.gatewayId)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  ).map((id) => {
    try {
      return BigInt(id);
    } catch {
      return null;
    }
  }).filter((id): id is bigint => id !== null);

  const modelIds = Array.from(
    new Set(
      filteredItems
        .map((a) => a.data.catalogModelId)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  ).map((id) => {
    try {
      return BigInt(id);
    } catch {
      return null;
    }
  }).filter((id): id is bigint => id !== null);

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

  const items: SanitizedRoutingAttemptDto[] = filteredItems.map((entry) => {
    const a = entry.data;
    const gwId = String(a.gatewayId ?? "");
    const mId = String(a.catalogModelId ?? "");
    const gw = gatewayMap.get(gwId);
    const m = modelMap.get(mId);

    return {
      id: entry.id,
      requestId: String(a.requestId ?? ""),
      userId: a.userId ? String(a.userId) : null,
      messageId: a.messageId ? String(a.messageId) : null,
      catalogModelId: mId,
      catalogModelName: m?.displayName,
      catalogModelPublicId: m?.publicId,
      gatewayId: gwId,
      gatewayName: gw?.name,
      gatewaySlug: gw?.slug,
      upstreamModelId: String(a.upstreamModelId ?? ""),
      attemptNo: typeof a.attemptNo === "number" ? a.attemptNo : 1,
      outcome: String(a.outcome ?? "unknown"),
      errorClass: a.errorClass ? String(a.errorClass) : null,
      httpStatus: typeof a.httpStatus === "number" ? a.httpStatus : null,
      latencyMs: typeof a.latencyMs === "number" ? a.latencyMs : 0,
      ttftMs: typeof a.ttftMs === "number" ? a.ttftMs : null,
      promptTokens: typeof a.promptTokens === "number" ? a.promptTokens : null,
      completionTokens: typeof a.completionTokens === "number" ? a.completionTokens : null,
      createdAt: entry.timestamp || new Date().toISOString(),
    };
  });

  return {
    items,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
    availableDates: result.availableDates,
  };
}
