import { db } from "@/lib/db";
import { mapGateway } from "@/lib/gateways/repository";
import { getCachedJson, setCachedJson, invalidateCachePattern } from "@/lib/redis/client";
import type { CandidateRoute } from "@/lib/gateways/types";
import { seedCircuit } from "./circuit";
import { getRoutingSettings } from "./settings";
import { normalizeStrategy, orderCandidates, type RoutingStrategy } from "./strategy";

export interface ResolvedCandidates {
  catalogModelId: bigint;
  publicId: string;
  defaultModelUsed: boolean;
  strategy: RoutingStrategy;
  routeCooldownSeconds: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  candidates: CandidateRoute[];
  routingVersion: number;
}

interface CacheEntry {
  data: ResolvedCandidates;
  version: number;
  expiresAt: number;
}

// In-memory fallback
const memoryCache = new Map<string, CacheEntry>();

export function clearCandidateCache(): void {
  memoryCache.clear();
  void invalidateCachePattern("routing:candidates:*");
}

function candidateCacheKey(version: number, publicId: string): string {
  return `routing:candidates:${version}:${publicId}`;
}

/**
 * Resolve the attempt order of candidate routes for a public catalog model id.
 * The DB route list (priority order) is cached in Redis (with in-memory fallback)
 * keyed on `routing.version` and `routing.cache_ttl_seconds`; the per-request
 * ordering (strategy, circuits, cooldowns) is applied on top of it every call.
 */
export async function resolveCandidates(
  requestedPublicId?: string | null,
  options?: { forceRefresh?: boolean; now?: number }
): Promise<ResolvedCandidates> {
  const now = options?.now ?? Date.now();
  const settings = await getRoutingSettings({ forceRefresh: options?.forceRefresh });
  const base = await loadBaseCandidates(requestedPublicId, settings, now, options?.forceRefresh);

  const candidates = await orderCandidates(base, settings, now);
  return { ...base, candidates };
}

async function loadBaseCandidates(
  requestedPublicId: string | null | undefined,
  settings: Awaited<ReturnType<typeof getRoutingSettings>>,
  now: number,
  forceRefresh?: boolean
): Promise<ResolvedCandidates> {
  const publicId = requestedPublicId?.trim() || settings.defaultModel;
  const defaultModelUsed = !requestedPublicId?.trim();

  const rKey = candidateCacheKey(settings.version, publicId);

  if (!forceRefresh) {
    // 1. Check in-memory fast cache
    const memHit = memoryCache.get(rKey);
    if (memHit && memHit.version === settings.version && now < memHit.expiresAt) {
      return memHit.data;
    }

    // 2. Check Redis cache
    const redisHit = await getCachedJson<ResolvedCandidates>(rKey);
    if (redisHit && redisHit.routingVersion === settings.version) {
      // Re-hydrate BigInt properties from JSON serialization
      const hydrated: ResolvedCandidates = {
        ...redisHit,
        catalogModelId: BigInt(redisHit.catalogModelId),
        strategy: normalizeStrategy(redisHit.strategy),
        routeCooldownSeconds: redisHit.routeCooldownSeconds ?? 0,
        inputPricePerMillion: Number(redisHit.inputPricePerMillion ?? 0),
        outputPricePerMillion: Number(redisHit.outputPricePerMillion ?? 0),
        candidates: redisHit.candidates.map((c) => ({
          ...c,
          weight: c.weight ?? 1,
          candidateId: BigInt(c.candidateId),
          upstreamModelId: BigInt(c.upstreamModelId),
          gateway: {
            ...c.gateway,
            id: BigInt(c.gateway.id),
          },
        })),
      };
      // Seed circuits for cached gateways
      for (const c of hydrated.candidates) {
        seedCircuit(c.gateway);
      }
      memoryCache.set(rKey, {
        data: hydrated,
        version: settings.version,
        expiresAt: now + settings.cacheTtlSeconds * 1000,
      });
      return hydrated;
    }
  }

  const catalogModel = await db.catalogModel.findUnique({
    where: { publicId },
    select: {
      id: true,
      publicId: true,
      status: true,
      routingStrategy: true,
      routeCooldownSeconds: true,
      inputPricePerMillion: true,
      outputPricePerMillion: true,
      routes: {
        where: {
          isEnabled: true,
          upstreamModel: {
            isAvailable: true,
            gateway: { isEnabled: true },
          },
        },
        orderBy: { priority: "asc" },
        select: {
          id: true,
          priority: true,
          weight: true,
          paramOverrides: true,
          upstreamModel: {
            select: {
              id: true,
              modelKey: true,
              gateway: true,
            },
          },
        },
      },
    },
  });

  if (!catalogModel || catalogModel.status !== "active") {
    const emptyResult: ResolvedCandidates = {
      catalogModelId: catalogModel?.id ?? 0n,
      publicId,
      defaultModelUsed,
      strategy: "priority",
      routeCooldownSeconds: 0,
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
      candidates: [],
      routingVersion: settings.version,
    };
    return emptyResult;
  }

  const candidates: CandidateRoute[] = catalogModel.routes.map((r) => {
    const gw = mapGateway(r.upstreamModel.gateway);
    seedCircuit(gw);
    return {
      candidateId: r.id,
      priority: r.priority,
      weight: r.weight,
      paramOverrides:
        r.paramOverrides && typeof r.paramOverrides === "object"
          ? (r.paramOverrides as Record<string, unknown>)
          : null,
      upstreamModelKey: r.upstreamModel.modelKey,
      upstreamModelId: r.upstreamModel.id,
      gateway: gw,
    };
  });

  const result: ResolvedCandidates = {
    catalogModelId: catalogModel.id,
    publicId: catalogModel.publicId,
    defaultModelUsed,
    strategy: normalizeStrategy(catalogModel.routingStrategy),
    routeCooldownSeconds: catalogModel.routeCooldownSeconds,
    inputPricePerMillion: Number(catalogModel.inputPricePerMillion ?? 0),
    outputPricePerMillion: Number(catalogModel.outputPricePerMillion ?? 0),
    candidates,
    routingVersion: settings.version,
  };

  memoryCache.set(rKey, {
    data: result,
    version: settings.version,
    expiresAt: now + settings.cacheTtlSeconds * 1000,
  });

  // Serialize BigInt to string for Redis storage
  const redisPayload = {
    ...result,
    catalogModelId: result.catalogModelId.toString(),
    candidates: result.candidates.map((c) => ({
      ...c,
      candidateId: c.candidateId.toString(),
      upstreamModelId: c.upstreamModelId.toString(),
      gateway: {
        ...c.gateway,
        id: c.gateway.id.toString(),
      },
    })),
  };
  await setCachedJson(rKey, redisPayload, settings.cacheTtlSeconds);

  return result;
}
