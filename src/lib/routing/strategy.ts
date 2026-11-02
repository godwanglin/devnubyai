import { redis } from "@/lib/redis/client";
import type { CandidateRoute } from "@/lib/gateways/types";
import { getCircuitOpenUntil } from "./circuit";
import type { RoutingSettings } from "./settings";

export const ROUTING_STRATEGIES = ["priority", "round_robin"] as const;
export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];

export function normalizeStrategy(value: unknown): RoutingStrategy {
  return value === "round_robin" ? "round_robin" : "priority";
}

// ───────────── Route cooldown (round robin only) ─────────────

/**
 * Per-route cooldown after a failure. Shared through Redis so every instance
 * skips the route, with an in-process copy for when Redis is unavailable.
 */
const localCooldowns = new Map<string, number>();

function cooldownKey(candidateId: bigint | string): string {
  return `routing:route_cooldown:${candidateId}`;
}

export function markRouteCooldown(candidateId: bigint, seconds: number, now = Date.now()): void {
  if (seconds <= 0) return;
  const until = now + seconds * 1000;
  localCooldowns.set(candidateId.toString(), until);

  const client = redis;
  if (client) {
    void client.set(cooldownKey(candidateId), String(until), "EX", seconds).catch(() => {});
  }
}

async function getRouteCooldowns(
  candidateIds: bigint[],
  now: number
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (const id of candidateIds) {
    const until = localCooldowns.get(id.toString());
    if (until && until > now) result.set(id.toString(), until);
  }

  const client = redis;
  if (client && candidateIds.length > 0) {
    try {
      const values = await client.mget(...candidateIds.map(cooldownKey));
      values.forEach((raw, i) => {
        const until = raw ? Number(raw) : NaN;
        if (Number.isFinite(until) && until > now) {
          const key = candidateIds[i].toString();
          result.set(key, Math.max(until, result.get(key) ?? 0));
        }
      });
    } catch {
      // Redis down: local cooldowns still apply.
    }
  }
  return result;
}

// ───────────── Smooth weighted round robin ─────────────

const sequenceCache = new Map<string, number[]>();
const localCounters = new Map<string, number>();

/**
 * Nginx-style smooth WRR: weights [3, 1] yield [0, 0, 1, 0]. Same ratio as
 * the weights, but interleaved so no route takes a burst of traffic.
 */
function smoothSequence(weights: number[]): number[] {
  const cacheKey = weights.join(",");
  const hit = sequenceCache.get(cacheKey);
  if (hit) return hit;

  const total = weights.reduce((sum, w) => sum + w, 0);
  const current = weights.map(() => 0);
  const sequence: number[] = [];
  for (let step = 0; step < total; step += 1) {
    let best = 0;
    for (let i = 0; i < weights.length; i += 1) {
      current[i] += weights[i];
      if (current[i] > current[best]) best = i;
    }
    current[best] -= total;
    sequence.push(best);
  }

  if (sequenceCache.size > 500) sequenceCache.clear();
  sequenceCache.set(cacheKey, sequence);
  return sequence;
}

async function nextRoundRobinTick(catalogModelId: bigint): Promise<number> {
  const key = `routing:rr:${catalogModelId}`;
  const client = redis;
  if (client) {
    try {
      return await client.incr(key);
    } catch {
      // Fall through to the local counter.
    }
  }
  const next = (localCounters.get(key) ?? 0) + 1;
  localCounters.set(key, next);
  return next;
}

// ───────────── Per-request ordering ─────────────

export interface OrderCandidatesInput {
  catalogModelId: bigint;
  strategy: RoutingStrategy;
  candidates: CandidateRoute[];
}

/**
 * Turn the cached, priority-ordered route list into this request's attempt
 * order. Runs on every request (never cached) because circuit state,
 * cooldowns and the round-robin pointer all change between requests.
 *
 * - priority: primary gateway first (if enabled in settings), then priority.
 * - round_robin: one route picked by smooth WRR among routes that are not
 *   cooling down; the rest follow in priority order as fallbacks, with
 *   cooling-down routes last.
 */
export async function orderCandidates(
  input: OrderCandidatesInput,
  settings: RoutingSettings,
  now = Date.now()
): Promise<CandidateRoute[]> {
  const { candidates, strategy } = input;
  if (candidates.length === 0) return [];

  const isRoundRobin = strategy === "round_robin";
  const cooldowns = isRoundRobin
    ? await getRouteCooldowns(candidates.map((c) => c.candidateId), now)
    : new Map<string, number>();

  let ordered = candidates;
  if (!isRoundRobin && settings.primaryFirst) {
    const primaries = candidates.filter((c) => c.gateway.isPrimary);
    const others = candidates.filter((c) => !c.gateway.isPrimary);
    ordered = [...primaries, ...others];
  }

  // Skip open circuits. Cooling-down routes are not dropped, only moved to the
  // back as a last resort. If every route is unusable, fall back to the one
  // released soonest (half-open) so it is never a total blackout.
  const available: CandidateRoute[] = [];
  const coolingDown: Array<{ candidate: CandidateRoute; until: number }> = [];
  const circuitOpen: Array<{ candidate: CandidateRoute; until: number }> = [];
  for (const c of ordered) {
    const circuitUntil = getCircuitOpenUntil(c.gateway.id, now);
    const cooldownUntil = cooldowns.get(c.candidateId.toString());
    if (circuitUntil !== null) circuitOpen.push({ candidate: c, until: circuitUntil });
    else if (cooldownUntil !== undefined) coolingDown.push({ candidate: c, until: cooldownUntil });
    else available.push(c);
  }
  coolingDown.sort((a, b) => a.until - b.until);

  if (available.length === 0 && coolingDown.length === 0) {
    if (circuitOpen.length === 0) return [];
    circuitOpen.sort((a, b) => a.until - b.until);
    return [circuitOpen[0].candidate];
  }

  if (isRoundRobin && available.length > 1) {
    const weights = available.map((c) => Math.max(1, c.weight));
    const sequence = smoothSequence(weights);
    const tick = await nextRoundRobinTick(input.catalogModelId);
    const picked = available[sequence[(tick - 1) % sequence.length]];
    ordered = [picked, ...available.filter((c) => c !== picked)];
  } else {
    ordered = available;
  }

  return [...ordered, ...coolingDown.map((e) => e.candidate)].slice(0, settings.maxAttempts);
}
