import { recordGatewayFailure, recordGatewaySuccess } from "@/lib/gateways/repository";
import { redis } from "@/lib/redis/client";
import type { DecryptedGatewayConfig } from "@/lib/gateways/types";
import type { GatewayError } from "./errors";
import type { RoutingSettings } from "./settings";

/**
 * Gateway Circuit Breaker State.
 * Synchronized with Redis so all cluster instances share the circuit state,
 * with an in-process memory cache for fast sub-millisecond lookups.
 */
interface CircuitState {
  consecutiveFailures: number;
  openUntil: number | null;
}

const localStates = new Map<string, CircuitState>();

function redisKey(gatewayId: bigint | string): string {
  return `circuit:gateway:${gatewayId}`;
}

function key(gatewayId: bigint): string {
  return gatewayId.toString();
}

/** Seed from a freshly loaded DB row, without discarding newer state. */
export function seedCircuit(gateway: DecryptedGatewayConfig): void {
  const gKey = key(gateway.id);
  if (localStates.has(gKey)) return;

  const openUntil = gateway.circuitOpenUntil ? gateway.circuitOpenUntil.getTime() : null;
  localStates.set(gKey, {
    consecutiveFailures: gateway.consecutiveFailures,
    openUntil,
  });

  // Sync to Redis asynchronously if Redis doesn't have it
  const client = redis;
  if (client) {
    const rKey = redisKey(gateway.id);
    void client.get(rKey).then((val) => {
      if (!val) {
        void client.set(
          rKey,
          JSON.stringify({
            consecutiveFailures: gateway.consecutiveFailures,
            openUntil,
          }),
          "EX",
          3600
        );
      } else {
        try {
          const parsed = JSON.parse(val) as CircuitState;
          localStates.set(gKey, parsed);
        } catch {}
      }
    });
  }
}

export function getCircuitOpenUntil(gatewayId: bigint, now = Date.now()): number | null {
  const state = localStates.get(key(gatewayId));
  if (!state?.openUntil || state.openUntil <= now) return null;
  return state.openUntil;
}

export function markSuccess(gatewayId: bigint): void {
  const gKey = key(gatewayId);
  localStates.set(gKey, { consecutiveFailures: 0, openUntil: null });

  const client = redis;
  if (client) {
    void client.set(
      redisKey(gatewayId),
      JSON.stringify({ consecutiveFailures: 0, openUntil: null }),
      "EX",
      3600
    );
  }

  void recordGatewaySuccess(gatewayId);
}

export function markFailure(
  gatewayId: bigint,
  error: GatewayError,
  settings: RoutingSettings
): void {
  const now = Date.now();
  const previous = localStates.get(key(gatewayId)) ?? { consecutiveFailures: 0, openUntil: null };
  const consecutiveFailures = previous.consecutiveFailures + 1;
  const shouldOpen = consecutiveFailures >= settings.circuitFailureThreshold;
  const openUntil = shouldOpen ? now + settings.circuitCooldownSeconds * 1000 : previous.openUntil;

  localStates.set(key(gatewayId), { consecutiveFailures, openUntil });

  const client = redis;
  if (client) {
    void client.set(
      redisKey(gatewayId),
      JSON.stringify({ consecutiveFailures, openUntil }),
      "EX",
      3600
    );
  }

  void recordGatewayFailure({
    gatewayId,
    consecutiveFailures,
    ...(shouldOpen ? { circuitOpenUntil: new Date(openUntil!), healthStatus: "down" as const } : {}),
    ...(!shouldOpen && error.errorClass === "auth" ? { healthStatus: "degraded" as const } : {}),
  });
}

/** Admin "Reset circuit" or tests. */
export function resetCircuit(gatewayId?: bigint): void {
  const client = redis;
  if (gatewayId === undefined) {
    localStates.clear();
    if (client) {
      void client.keys("circuit:gateway:*").then((keys) => {
        if (keys.length > 0) void client.del(...keys);
      });
    }
  } else {
    localStates.delete(key(gatewayId));
    if (client) {
      void client.del(redisKey(gatewayId));
    }
  }
}
