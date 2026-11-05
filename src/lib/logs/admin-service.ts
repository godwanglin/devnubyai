import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/client";
import type { RoutingErrorClass } from "@/lib/gateways/types";
import { readLogs } from "@/lib/logger/file-logger";
import { computeCostUsd, toUsd } from "@/lib/billing/cost";
import { mapProviderError } from "@/lib/routing/error-mapping";

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

export interface SanitizedCandidateAttemptDto {
  attemptNo: number;
  gatewayId: string;
  gatewayName?: string;
  upstreamModelId: string;
  upstreamModelKey?: string;
  outcome: string;
  errorRuleId: string | null;
  errorClass: string | null;
  httpStatus: number | null;
  providerError: string | null;
  rawProviderError: string | null;
  latencyMs: number;
  ttftMs: number | null;
}

export interface SanitizedRoutingAttemptDto {
  id: string;
  requestId: string;
  userId: string | null;
  userName?: string | null;
  userEmail?: string | null;
  userPublicId?: string | null;
  messageId: string | null;
  catalogModelId: string;
  catalogModelName?: string;
  catalogModelPublicId?: string;
  gatewayId: string;
  gatewayName?: string;
  gatewaySlug?: string;
  upstreamModelId: string;
  upstreamModelKey?: string;
  attemptNo: number;
  outcome: string;
  hadFallback: boolean;
  errorRuleId: string | null;
  errorClass: string | null;
  httpStatus: number | null;
  providerError: string | null;
  clientError: string | null;
  latencyMs: number;
  ttftMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number;
  candidates: SanitizedCandidateAttemptDto[];
  createdAt: string;
}

export interface ChatErrorTraceDto {
  /** Assistant message id; the request id lives inside the trace itself */
  messageId: string;
  sessionId: string;
  userName: string | null;
  userEmail: string | null;
  /** Short line the user saw in the chat bubble */
  clientError: string;
  /** The real failure: request id, class, message and stack */
  trace: string;
  errorCode: string | null;
  requestId: string | null;
  modelName: string | null;
  createdAt: string;
}

export const chatErrorQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(15),
});

export type ChatErrorQuery = z.infer<typeof chatErrorQuerySchema>;

/**
 * Failed turns whose real trace an admin can search. Matches the request id, the error
 * code, the trace text and the friendly line the user saw.
 */
export async function listChatErrorTraces(query: ChatErrorQuery) {
  const term = query.search?.trim();
  const where: Prisma.ChatMessageWhereInput = {
    status: "failed",
    errorDetail: { not: null },
    ...(term
      ? {
          OR: [
            { requestId: { contains: term, mode: "insensitive" } },
            { errorDetail: { contains: term, mode: "insensitive" } },
            { errorCode: { contains: term, mode: "insensitive" } },
            { content: { contains: term, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.chatMessage.count({ where }),
    db.chatMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        publicId: true,
        content: true,
        errorCode: true,
        errorDetail: true,
        requestId: true,
        createdAt: true,
        catalogModel: { select: { displayName: true } },
        session: { select: { publicId: true, user: { select: { name: true, email: true } } } },
      },
    }),
  ]);

  const items: ChatErrorTraceDto[] = rows.map((row) => ({
    messageId: row.publicId,
    sessionId: row.session.publicId,
    userName: row.session.user.name,
    userEmail: row.session.user.email,
    clientError: row.content,
    trace: row.errorDetail ?? "",
    errorCode: row.errorCode,
    requestId: row.requestId,
    modelName: row.catalogModel?.displayName ?? null,
    createdAt: row.createdAt.toISOString(),
  }));

  return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) };
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
  userId: z.string().optional(),
  date: z.string().optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(15),
});

export type RoutingAttemptsQuery = z.infer<typeof routingAttemptsQuerySchema>;

function toBigIntIds(values: Array<unknown>): bigint[] {
  const unique = new Set<string>();
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) unique.add(v.trim());
    else if (typeof v === "number") unique.add(String(v));
  }
  const out: bigint[] = [];
  for (const id of unique) {
    try {
      out.push(BigInt(id));
    } catch {
      // ignore non-numeric IDs
    }
  }
  return out;
}

/**
 * Reads telemetry routing attempts directly from daily file logs (.logs/YYYY-MM-DD.log)
 * and enriches user, model, candidate route, cost ($), and mapped errors.
 */
export async function listRoutingAttempts(query: RoutingAttemptsQuery) {
  const result = await readLogs({
    date: query.date,
    type: "routing",
    search: query.search,
    outcome: query.outcome,
    gatewayId: query.gatewayId,
    userId: query.userId,
    page: query.page,
    pageSize: query.pageSize,
  });

  const filteredItems = result.items;

  // Collect IDs across top-level entries and nested candidates for batch enrichment
  const rawGatewayIds: unknown[] = [];
  const rawCatalogModelIds: unknown[] = [];
  const rawUpstreamModelIds: unknown[] = [];
  const rawUserIds: unknown[] = [];

  for (const item of filteredItems) {
    const a = item.data;
    rawGatewayIds.push(a.gatewayId);
    rawCatalogModelIds.push(a.catalogModelId);
    rawUpstreamModelIds.push(a.upstreamModelId);
    rawUserIds.push(item.userId ?? a.userId);

    if (Array.isArray(a.candidates)) {
      for (const c of a.candidates) {
        if (c && typeof c === "object") {
          const cand = c as Record<string, unknown>;
          rawGatewayIds.push(cand.gatewayId);
          rawUpstreamModelIds.push(cand.upstreamModelId);
        }
      }
    }
  }

  const gatewayIds = toBigIntIds(rawGatewayIds);
  const modelIds = toBigIntIds(rawCatalogModelIds);
  const upstreamIds = toBigIntIds(rawUpstreamModelIds);
  const userIds = toBigIntIds(rawUserIds);

  const [gateways, catalogModels, upstreamModels, users] = await Promise.all([
    gatewayIds.length > 0
      ? db.gateway.findMany({
          where: { id: { in: gatewayIds } },
          select: { id: true, name: true, slug: true },
        })
      : [],
    modelIds.length > 0
      ? db.catalogModel.findMany({
          where: { id: { in: modelIds } },
          select: {
            id: true,
            displayName: true,
            publicId: true,
            inputPricePerMillion: true,
            outputPricePerMillion: true,
          },
        })
      : [],
    upstreamIds.length > 0
      ? db.upstreamModel.findMany({
          where: { id: { in: upstreamIds } },
          select: { id: true, modelKey: true },
        })
      : [],
    userIds.length > 0
      ? db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, publicId: true },
        })
      : [],
  ]);

  const gatewayMap = new Map(gateways.map((g) => [g.id.toString(), g]));
  const modelMap = new Map(catalogModels.map((m) => [m.id.toString(), m]));
  const upstreamMap = new Map(upstreamModels.map((u) => [u.id.toString(), u]));
  const userMap = new Map(users.map((u) => [u.id.toString(), u]));

  const items: SanitizedRoutingAttemptDto[] = filteredItems.map((entry) => {
    const a = entry.data;
    const gwId = String(a.gatewayId ?? "");
    const mId = String(a.catalogModelId ?? "");
    const upId = String(a.upstreamModelId ?? "");
    const uId = entry.userId || (a.userId ? String(a.userId) : null);

    const gw = gatewayMap.get(gwId);
    const m = modelMap.get(mId);
    const up = upstreamMap.get(upId);
    const usr = uId ? userMap.get(uId) : undefined;

    const outcome = String(a.outcome ?? "unknown");
    const isError = outcome === "failed" || outcome === "aborted" || outcome === "fallback";
    const errorClass = a.errorClass ? String(a.errorClass) : null;
    const httpStatus = typeof a.httpStatus === "number" ? a.httpStatus : null;

    // Resolve mapped providerError & clientError (supports both new logs and legacy logs)
    let providerError = typeof a.providerError === "string" ? a.providerError : null;
    let clientError = typeof a.clientError === "string" ? a.clientError : null;
    let errorRuleId = typeof a.errorRuleId === "string" ? a.errorRuleId : null;

    if (isError && (!providerError || (outcome === "failed" && !clientError))) {
      const fallbackMapped = mapProviderError({
        httpStatus,
        rawText: errorClass,
        clientAborted: errorClass === "client_aborted" || outcome === "aborted",
        timedOut: errorClass === "timeout",
        fallbackErrorClass: (errorClass as RoutingErrorClass | null) ?? undefined,
      });
      if (!errorRuleId) errorRuleId = fallbackMapped.ruleId;
      if (!providerError) providerError = fallbackMapped.providerMessage;
      if ((outcome === "failed" || outcome === "aborted") && !clientError) {
        clientError = fallbackMapped.clientMessage;
      }
    }

    const promptTokens = typeof a.promptTokens === "number" ? a.promptTokens : null;
    const completionTokens = typeof a.completionTokens === "number" ? a.completionTokens : null;

    // Resolve cost in USD ($)
    let costUsd = typeof a.costUsd === "number" ? a.costUsd : null;
    if (costUsd === null) {
      if ((promptTokens || completionTokens) && m) {
        costUsd = toUsd(
          computeCostUsd(
            promptTokens ?? 0,
            completionTokens ?? 0,
            m.inputPricePerMillion,
            m.outputPricePerMillion
          )
        );
      } else {
        costUsd = 0;
      }
    }

    const resolvedGatewayName =
      (typeof a.gatewayName === "string" && a.gatewayName) || gw?.name || (gwId ? `Gateway #${gwId}` : undefined);
    const resolvedUpstreamKey =
      (typeof a.upstreamModelKey === "string" && a.upstreamModelKey) ||
      up?.modelKey ||
      (upId ? `Upstream #${upId}` : undefined);

    // Build candidates list
    const candidates: SanitizedCandidateAttemptDto[] = Array.isArray(a.candidates) && a.candidates.length > 0
      ? a.candidates.map((rawCand, idx) => {
          const c = (rawCand && typeof rawCand === "object" ? rawCand : {}) as Record<string, unknown>;
          const cGwId = String(c.gatewayId ?? gwId);
          const cUpId = String(c.upstreamModelId ?? upId);
          const cGw = gatewayMap.get(cGwId);
          const cUp = upstreamMap.get(cUpId);
          const cOutcome = String(c.outcome ?? outcome);
          const cErrorClass = c.errorClass ? String(c.errorClass) : null;
          const cHttpStatus = typeof c.httpStatus === "number" ? c.httpStatus : null;
          let cProviderError = typeof c.providerError === "string" ? c.providerError : null;
          let cRuleId = typeof c.errorRuleId === "string" ? c.errorRuleId : null;

          if ((cOutcome === "fallback" || cOutcome === "failed" || cOutcome === "aborted") && !cProviderError) {
            const cMapped = mapProviderError({
              httpStatus: cHttpStatus,
              rawText: cErrorClass,
              clientAborted: cErrorClass === "client_aborted" || cOutcome === "aborted",
              timedOut: cErrorClass === "timeout",
              fallbackErrorClass: (cErrorClass as RoutingErrorClass | null) ?? undefined,
            });
            cProviderError = cMapped.providerMessage;
            if (!cRuleId) cRuleId = cMapped.ruleId;
          }

          return {
            attemptNo: typeof c.attemptNo === "number" ? c.attemptNo : idx + 1,
            gatewayId: cGwId,
            gatewayName:
              (typeof c.gatewayName === "string" && c.gatewayName) ||
              cGw?.name ||
              (cGwId ? `Gateway #${cGwId}` : undefined),
            upstreamModelId: cUpId,
            upstreamModelKey:
              (typeof c.upstreamModelKey === "string" && c.upstreamModelKey) ||
              cUp?.modelKey ||
              (cUpId ? `Upstream #${cUpId}` : undefined),
            outcome: cOutcome,
            errorRuleId: cRuleId,
            errorClass: cErrorClass,
            httpStatus: cHttpStatus,
            providerError: cProviderError,
            rawProviderError: typeof c.rawProviderError === "string" ? c.rawProviderError : null,
            latencyMs: typeof c.latencyMs === "number" ? c.latencyMs : 0,
            ttftMs: typeof c.ttftMs === "number" ? c.ttftMs : null,
          };
        })
      : [
          {
            attemptNo: typeof a.attemptNo === "number" ? a.attemptNo : 1,
            gatewayId: gwId,
            gatewayName: resolvedGatewayName,
            upstreamModelId: upId,
            upstreamModelKey: resolvedUpstreamKey,
            outcome,
            errorRuleId,
            errorClass,
            httpStatus,
            providerError,
            rawProviderError: typeof a.rawProviderError === "string" ? a.rawProviderError : null,
            latencyMs: typeof a.latencyMs === "number" ? a.latencyMs : 0,
            ttftMs: typeof a.ttftMs === "number" ? a.ttftMs : null,
          },
        ];

    const hadFallback = Boolean(
      a.hadFallback ||
        outcome === "fallback" ||
        candidates.some((c) => c.outcome === "fallback") ||
        candidates.length > 1
    );

    return {
      id: entry.id,
      requestId: String(a.requestId ?? ""),
      userId: uId,
      userName: usr?.name ?? null,
      userEmail: usr?.email ?? null,
      userPublicId: usr?.publicId ?? null,
      messageId: a.messageId ? String(a.messageId) : null,
      catalogModelId: mId,
      catalogModelName: m?.displayName,
      catalogModelPublicId:
        (typeof a.catalogModelPublicId === "string" && a.catalogModelPublicId) || m?.publicId,
      gatewayId: gwId,
      gatewayName: resolvedGatewayName,
      gatewaySlug: gw?.slug,
      upstreamModelId: upId,
      upstreamModelKey: resolvedUpstreamKey,
      attemptNo: typeof a.attemptNo === "number" ? a.attemptNo : candidates.length,
      outcome,
      hadFallback,
      errorRuleId,
      errorClass,
      httpStatus,
      providerError,
      clientError,
      latencyMs: typeof a.latencyMs === "number" ? a.latencyMs : 0,
      ttftMs: typeof a.ttftMs === "number" ? a.ttftMs : null,
      promptTokens,
      completionTokens,
      costUsd,
      candidates,
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
