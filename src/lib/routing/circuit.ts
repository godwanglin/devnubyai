import { recordGatewayFailure, recordGatewaySuccess } from "@/lib/gateways/repository";
import type { DecryptedGatewayConfig } from "@/lib/gateways/types";
import type { GatewayError } from "./errors";
import type { RoutingSettings } from "./settings";

/**
 * In-process view of each gateway's circuit, seeded from DB columns and kept
 * current by the executor. DB writes are fire-and-forget so streams never block.
 */
interface CircuitState {
  consecutiveFailures: number;
  openUntil: number | null;
}

const states = new Map<string, CircuitState>();

function key(gatewayId: bigint): string {
  return gatewayId.toString();
}

/** Seed from a freshly loaded DB row, without discarding newer in-process state. */
export function seedCircuit(gateway: DecryptedGatewayConfig): void {
  if (states.has(key(gateway.id))) return;
  states.set(key(gateway.id), {
    consecutiveFailures: gateway.consecutiveFailures,
    openUntil: gateway.circuitOpenUntil ? gateway.circuitOpenUntil.getTime() : null,
  });
}

export function getCircuitOpenUntil(gatewayId: bigint, now = Date.now()): number | null {
  const state = states.get(key(gatewayId));
  if (!state?.openUntil || state.openUntil <= now) return null;
  return state.openUntil;
}

export function markSuccess(gatewayId: bigint): void {
  states.set(key(gatewayId), { consecutiveFailures: 0, openUntil: null });
  void recordGatewaySuccess(gatewayId);
}

export function markFailure(
  gatewayId: bigint,
  error: GatewayError,
  settings: RoutingSettings
): void {
  const now = Date.now();
  const previous = states.get(key(gatewayId)) ?? { consecutiveFailures: 0, openUntil: null };
  const consecutiveFailures = previous.consecutiveFailures + 1;
  const shouldOpen = consecutiveFailures >= settings.circuitFailureThreshold;
  const openUntil = shouldOpen ? now + settings.circuitCooldownSeconds * 1000 : previous.openUntil;

  states.set(key(gatewayId), { consecutiveFailures, openUntil });
  void recordGatewayFailure({
    gatewayId,
    consecutiveFailures,
    ...(shouldOpen ? { circuitOpenUntil: new Date(openUntil!), healthStatus: "down" as const } : {}),
    ...(!shouldOpen && error.errorClass === "auth" ? { healthStatus: "degraded" as const } : {}),
  });
}

/** Admin "Reset circuit" or tests. */
export function resetCircuit(gatewayId?: bigint): void {
  if (gatewayId === undefined) states.clear();
  else states.delete(key(gatewayId));
}
