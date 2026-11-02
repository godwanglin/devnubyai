import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto/vault";
import type { DecryptedGatewayConfig } from "./types";

export interface GatewayRow {
  id: bigint;
  slug: string;
  name: string;
  baseUrl: string;
  wireApi: string;
  modelsPath: string;
  apiKeyCiphertext: Uint8Array<ArrayBuffer> | Buffer;
  extraHeaders: unknown;
  isPrimary: boolean;
  isEnabled: boolean;
  priority: number;
  timeoutMs: number;
  firstTokenTimeoutMs: number;
  healthStatus: string;
  consecutiveFailures: number;
  circuitOpenUntil: Date | null;
  authType: string;
  oauthProvider: string | null;
}

function parseHeaders(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val === "string") {
      result[key] = val;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function mapGateway(row: GatewayRow): DecryptedGatewayConfig {
  const apiKey = decryptSecret(row.apiKeyCiphertext);
  const wireApi: "chat" | "responses" =
    row.wireApi === "responses" ? "responses" : "chat";
  const healthStatus: "unknown" | "healthy" | "degraded" | "down" =
    row.healthStatus === "healthy" ||
    row.healthStatus === "degraded" ||
    row.healthStatus === "down"
      ? row.healthStatus
      : "unknown";

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    baseUrl: row.baseUrl.replace(/\/+$/, ""),
    wireApi,
    modelsPath: row.modelsPath,
    apiKey,
    extraHeaders: parseHeaders(row.extraHeaders),
    isPrimary: row.isPrimary,
    isEnabled: row.isEnabled,
    priority: row.priority,
    timeoutMs: row.timeoutMs,
    firstTokenTimeoutMs: row.firstTokenTimeoutMs,
    healthStatus,
    consecutiveFailures: row.consecutiveFailures,
    circuitOpenUntil: row.circuitOpenUntil,
    authType: row.authType === "oauth" ? "oauth" : "api_key",
    oauthProvider: row.oauthProvider ?? null,
  };
}

/**
 * Find all enabled gateways ordered by primary first, then priority.
 */
export async function getEnabledGateways(): Promise<DecryptedGatewayConfig[]> {
  const rows = await db.gateway.findMany({
    where: { isEnabled: true },
    orderBy: [{ isPrimary: "desc" }, { priority: "asc" }],
  });
  return rows.map(mapGateway);
}

/**
 * Get single gateway by slug with decrypted credentials.
 */
export async function getGatewayBySlug(
  slug: string
): Promise<DecryptedGatewayConfig | null> {
  const row = await db.gateway.findUnique({
    where: { slug },
  });
  if (!row) return null;
  return mapGateway(row);
}

/**
 * Get single gateway by numeric ID.
 */
export async function getGatewayById(
  id: bigint
): Promise<DecryptedGatewayConfig | null> {
  const row = await db.gateway.findUnique({
    where: { id },
  });
  if (!row) return null;
  return mapGateway(row);
}

/**
 * Fire-and-forget helper to record gateway health updates.
 * Never throws to avoid interrupting active streaming pipelines.
 */
export async function recordGatewaySuccess(gatewayId: bigint): Promise<void> {
  try {
    await db.gateway.update({
      where: { id: gatewayId },
      data: {
        consecutiveFailures: 0,
        healthStatus: "healthy",
        lastSuccessAt: new Date(),
        circuitOpenUntil: null,
      },
    });
  } catch (err) {
    console.error(`[GATEWAY_SUCCESS_RECORD_ERROR] [${gatewayId.toString()}]`, err);
  }
}

export async function recordGatewayFailure(params: {
  gatewayId: bigint;
  consecutiveFailures: number;
  circuitOpenUntil?: Date | null;
  healthStatus?: "degraded" | "down";
}): Promise<void> {
  try {
    await db.gateway.update({
      where: { id: params.gatewayId },
      data: {
        consecutiveFailures: params.consecutiveFailures,
        lastFailureAt: new Date(),
        ...(params.circuitOpenUntil !== undefined
          ? { circuitOpenUntil: params.circuitOpenUntil }
          : {}),
        ...(params.healthStatus ? { healthStatus: params.healthStatus } : {}),
      },
    });
  } catch (err) {
    console.error(
      `[GATEWAY_FAILURE_RECORD_ERROR] [${params.gatewayId.toString()}]`,
      err
    );
  }
}
