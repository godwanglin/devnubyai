import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { getCachedJson, setCachedJson } from "@/lib/redis/client";
import { FREE_PLAN_SLUG, isPlanExpired } from "@/lib/plans/effective-plan";

/**
 * Plan → allowed catalog model ids, cached in memory (30s) and Redis (1h). The
 * Redis key sits under `catalog:models:*`, so `invalidateActiveCatalogCache`
 * (run on every plan / catalog edit) drops it; `clearModelAccessCache` drops
 * the in-memory copy at the same time.
 */
const L1_TTL_MS = 30_000;
const REDIS_TTL_SECONDS = 3600;
const planModelsL1 = new Map<string, { ids: Set<string>; expiresAt: number }>();
let freePlanL1: { id: bigint | null; expiresAt: number } | null = null;

const accessKey = (planId: bigint) => `catalog:models:access:${planId}`;
const FREE_PLAN_KEY = "catalog:models:free-plan-id";

export function clearModelAccessCache(): void {
  planModelsL1.clear();
  freePlanL1 = null;
}

async function freePlanId(): Promise<bigint | null> {
  const now = Date.now();
  if (freePlanL1 && now < freePlanL1.expiresAt) return freePlanL1.id;

  const cached = await getCachedJson<{ id: string | null }>(FREE_PLAN_KEY);
  let id: bigint | null;
  if (cached) {
    id = cached.id ? BigInt(cached.id) : null;
  } else {
    const plan = await db.plan.findUnique({ where: { slug: FREE_PLAN_SLUG }, select: { id: true } });
    id = plan?.id ?? null;
    await setCachedJson(FREE_PLAN_KEY, { id: id?.toString() ?? null }, REDIS_TTL_SECONDS);
  }
  freePlanL1 = { id, expiresAt: now + L1_TTL_MS };
  return id;
}

async function allowedModelIds(planId: bigint): Promise<Set<string>> {
  const now = Date.now();
  const l1 = planModelsL1.get(planId.toString());
  if (l1 && now < l1.expiresAt) return l1.ids;

  let ids = await getCachedJson<string[]>(accessKey(planId));
  if (!ids) {
    const rows = await db.planModelAccess.findMany({ where: { planId }, select: { catalogModelId: true } });
    ids = rows.map((r) => r.catalogModelId.toString());
    await setCachedJson(accessKey(planId), ids, REDIS_TTL_SECONDS);
  }
  const set = new Set(ids);
  planModelsL1.set(planId.toString(), { ids: set, expiresAt: now + L1_TTL_MS });
  return set;
}

/** Plan fields of the signed-in user; `planId`/`plan` are already the effective plan. */
export interface ModelAccessUser {
  planId: bigint | null;
  plan: { name: string } | null;
}

/**
 * Throws 403 when the user's plan does not include the model. Pass the session
 * user to skip the Postgres user lookup (its plan is already the effective one).
 */
export async function assertUserModelAccess(
  userId: bigint,
  catalogModelId: bigint,
  sessionUser?: ModelAccessUser
): Promise<void> {
  let planId: bigint | null;
  let planName: string;

  if (sessionUser) {
    planId = sessionUser.planId;
    planName = sessionUser.plan?.name || "Free";
  } else {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { planId: true, planExpiresAt: true, plan: { select: { name: true } } },
    });
    if (!user) throw ApiError.unauthorized("User account not found");
    const expired = isPlanExpired(user.planExpiresAt);
    planId = expired ? null : user.planId;
    planName = (!expired && user.plan?.name) || "Free";
  }

  if (!planId) planId = await freePlanId();
  if (!planId) {
    throw ApiError.forbidden("Akun Anda tidak memiliki paket langganan aktif.");
  }

  if (!(await allowedModelIds(planId)).has(catalogModelId.toString())) {
    throw ApiError.forbidden(
      `Model ini tidak termasuk dalam ${planName} Anda. Silakan tingkatkan paket Anda ke Pro di /plans untuk mengaksesnya.`
    );
  }
}
