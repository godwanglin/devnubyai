import { db } from "@/lib/db";
import type { Prisma } from "@/generated/client";

export interface RecordAuditParams {
  actorUserId: bigint | null;
  action: string;
  entityType:
    | "gateway"
    | "provider_connection"
    | "upstream_model"
    | "catalog_model"
    | "route"
    | "routing_setting"
    | "app_setting"
    | "system_prompt"
    | "payment_method"
    | "payment_transaction"
    | "plan"
    | "plan_model_access"
    | "user";
  entityId: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
}

export type DbClient = Prisma.TransactionClient | typeof db;

const REDACTED_KEYS = new Set([
  "apikey",
  "apikeyraw",
  "apikeyciphertext",
  "password",
  "passwordhash",
  "chatpinhash",
  "secret",
  "token",
  "authorization",
  "extraheaders",
]);

function sanitizeAuditValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeAuditValue);
  }
  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACTED_KEYS.has(k.toLowerCase())) {
        continue;
      }
      const cleaned = sanitizeAuditValue(v);
      if (cleaned !== undefined) {
        sanitized[k] = cleaned;
      }
    }
    return sanitized;
  }
  return value;
}

export function sanitizeAuditState(
  state?: Record<string, unknown> | null
): Prisma.InputJsonValue | undefined {
  if (!state) return undefined;
  return sanitizeAuditValue(state) as Prisma.InputJsonValue;
}

/**
 * Persists an administrative action into `admin_audit_logs`.
 * When a transaction client is passed, the audit log joins that transaction.
 */
export async function recordAdminAudit(
  params: RecordAuditParams,
  client: DbClient = db
): Promise<void> {
  const { actorUserId, action, entityType, entityId, beforeState, afterState } = params;

  await client.adminAuditLog.create({
    data: {
      actorUserId,
      action,
      entityType,
      entityId,
      beforeState: sanitizeAuditState(beforeState),
      afterState: sanitizeAuditState(afterState),
    },
  });
}
