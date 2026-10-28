import { db } from "@/lib/db";
import { mapGateway } from "@/lib/gateways/repository";
import { getCachedJson, setCachedJson, invalidateCachePattern } from "@/lib/redis/client";
import type { CandidateRoute } from "@/lib/gateways/types";
import { getCircuitOpenUntil, seedCircuit } from "./circuit";
import { getRoutingSettings } from "./settings";

export interface ResolvedCandidates {
  catalogModelId: bigint;
  publicId: string;
  defaultModelUsed: boolean;
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
 * Resolve ordered candidate routes for a public catalog model id.
 * Uses Redis cache (with in-memory fallback) keyed on `routing.version` and `routing.cache_ttl_seconds`.
 */
export async function resolveCandidates(
  requestedPublicId?: string | null,
  options?: { forceRefresh?: boolean; now?: number }
): Promise<ResolvedCandidates> {
  const now = options?.now ?? Date.now();
  const settings = await getRoutingSettings({ forceRefresh: options?.forceRefresh });
  const publicId = requestedPublicId?.trim() || settings.defaultModel;
  const defaultModelUsed = !requestedPublicId?.trim();

  const rKey = candidateCacheKey(settings.version, publicId);

  if (!options?.forceRefresh) {
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
        candidates: redisHit.candidates.map((c) => ({
          ...c,
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
      candidates: [],
      routingVersion: settings.version,
    };
    return emptyResult;
  }

  const routes = catalogModel.routes;
  const rawCandidates: CandidateRoute[] = routes.map((r) => {
    const gw = mapGateway(r.upstreamModel.gateway);
    seedCircuit(gw);
    return {
      candidateId: r.id,
      priority: r.priority,
      paramOverrides:
        r.paramOverrides && typeof r.paramOverrides === "object"
          ? (r.paramOverrides as Record<string, unknown>)
          : null,
      upstreamModelKey: r.upstreamModel.modelKey,
      upstreamModelId: r.upstreamModel.id,
      gateway: gw,
    };
  });

  // Reorder primary first if configured
  let ordered = rawCandidates;
  if (settings.primaryFirst) {
    const primaries = rawCandidates.filter((c) => c.gateway.isPrimary);
    const others = rawCandidates.filter((c) => !c.gateway.isPrimary);
    ordered = [...primaries, ...others];
  }

  // Filter open circuits, but if all are open, fall back to the one closing soonest (half-open)
  const circuitAvailable: CandidateRoute[] = [];
  const circuitOpen: Array<{ candidate: CandidateRoute; openUntil: number }> = [];

  for (const c of ordered) {
    const openUntil = getCircuitOpenUntil(c.gateway.id, now);
    if (openUntil === null) {
      circuitAvailable.push(c);
    } else {
      circuitOpen.push({ candidate: c, openUntil });
    }
  }

  let finalCandidates: CandidateRoute[];
  if (circuitAvailable.length > 0) {
    finalCandidates = circuitAvailable;
  } else if (circuitOpen.length > 0) {
    circuitOpen.sort((a, b) => a.openUntil - b.openUntil);
    finalCandidates = [circuitOpen[0].candidate];
  } else {
    finalCandidates = [];
  }

  const capped = finalCandidates.slice(0, settings.maxAttempts);

  const result: ResolvedCandidates = {
    catalogModelId: catalogModel.id,
    publicId: catalogModel.publicId,
    defaultModelUsed,
    candidates: capped,
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
