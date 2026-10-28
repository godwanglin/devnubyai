import { db } from "@/lib/db";
import { mapGateway } from "@/lib/gateways/repository";
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

const memoryCache = new Map<string, CacheEntry>();

export function clearCandidateCache(): void {
  memoryCache.clear();
}

/**
 * Resolve ordered candidate routes for a public catalog model id.
 * Uses a memory cache keyed on `routing.version` and `routing.cache_ttl_seconds`.
 */
export async function resolveCandidates(
  requestedPublicId?: string | null,
  options?: { forceRefresh?: boolean; now?: number }
): Promise<ResolvedCandidates> {
  const now = options?.now ?? Date.now();
  const settings = await getRoutingSettings({ forceRefresh: options?.forceRefresh });
  const publicId = requestedPublicId?.trim() || settings.defaultModel;
  const defaultModelUsed = !requestedPublicId?.trim();

  const cacheKey = `${settings.version}:${publicId}`;
  if (!options?.forceRefresh) {
    const hit = memoryCache.get(cacheKey);
    if (hit && hit.version === settings.version && now < hit.expiresAt) {
      return hit.data;
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

  memoryCache.set(cacheKey, {
    data: result,
    version: settings.version,
    expiresAt: now + settings.cacheTtlSeconds * 1000,
  });

  return result;
}
