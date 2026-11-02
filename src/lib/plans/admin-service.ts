import { z } from "zod";
import { partialUpdate } from "@/lib/api/zod-partial";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { recordAdminAudit } from "@/lib/admin/audit";
import { invalidateActiveCatalogCache } from "@/lib/catalog/cache";
import { costLimit, toUsd } from "@/lib/billing/cost";
import { validateCostLimits } from "./cost-limits";
import { normalizePlanFeatures, planFeaturesSchema, type PlanFeature } from "./features";
import {
  PLAN_DISCOUNT_TYPES,
  applyPlanDiscount,
  validatePlanDiscount,
  isPlanDiscountType,
  type PlanDiscountType,
  type PlanDiscount,
} from "./pricing";
import type { Prisma } from "@/generated/client";

export const createPlanSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[a-z0-9_-]+$/i, "Slug must contain only alphanumeric, underscores, or hyphens"),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(255).optional().nullable(),
  priceMonthly: z.number().int().min(0).default(0),
  priceYearly: z.number().int().min(0).default(0),
  currency: z.string().trim().max(8).default("IDR"),
  discountMonthlyType: z.enum(PLAN_DISCOUNT_TYPES).optional().nullable(),
  discountMonthlyValue: z.number().int().min(0).optional().nullable(),
  discountYearlyType: z.enum(PLAN_DISCOUNT_TYPES).optional().nullable(),
  discountYearlyValue: z.number().int().min(0).optional().nullable(),
  // Spend caps in USD; 0 or null means the window has no limit.
  monthlyCostLimitUsd: z.number().finite().min(0).max(100000).optional().nullable(),
  weeklyCostLimitUsd: z.number().finite().min(0).max(100000).optional().nullable(),
  fiveHourCostLimitUsd: z.number().finite().min(0).max(100000).optional().nullable(),
  dailyRequestLimit: z.number().int().positive().optional().nullable(),
  requestsPerMinute: z.number().int().positive().optional().nullable(),
  // Rolling 24h upload size caps in MB; 0 or null means unlimited.
  dailyUploadLimitMb: z.number().int().min(0).max(1000000).optional().nullable(),
  dailyAgentUploadLimitMb: z.number().int().min(0).max(1000000).optional().nullable(),
  maxParallelRequests: z.number().int().min(0).max(100).optional().nullable(),
  badge: z.string().trim().max(32).optional().nullable(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(65535).default(100),
  allowedModelIds: z.array(z.string()).default([]),
  // "Capacity & Quotas" rows on the plan card (auto + manual, per-language text)
  features: planFeaturesSchema.optional(),
});

export const updatePlanSchema = partialUpdate(createPlanSchema);

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

export interface PlanDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  discountMonthlyType: PlanDiscountType | null;
  discountMonthlyValue: number | null;
  discountYearlyType: PlanDiscountType | null;
  discountYearlyValue: number | null;
  effectivePriceMonthly: number;
  effectivePriceYearly: number;
  monthlyCostLimitUsd: number | null;
  weeklyCostLimitUsd: number | null;
  fiveHourCostLimitUsd: number | null;
  dailyRequestLimit: number | null;
  requestsPerMinute: number | null;
  dailyUploadLimitMb: number | null;
  dailyAgentUploadLimitMb: number | null;
  maxParallelRequests: number | null;
  badge: string | null;
  isActive: boolean;
  sortOrder: number;
  userCount: number;
  allowedModelIds: string[];
  features: PlanFeature[];
  createdAt: string;
  updatedAt: string;
}

/** Monthly and yearly discounts are independent; each applies only to its own billing cycle. */
export function readPlanDiscounts(plan: {
  discountMonthlyType: string | null;
  discountMonthlyValue: number | null;
  discountYearlyType: string | null;
  discountYearlyValue: number | null;
}): { monthly: PlanDiscount; yearly: PlanDiscount } {
  return {
    monthly: {
      discountType: isPlanDiscountType(plan.discountMonthlyType) ? plan.discountMonthlyType : null,
      discountValue: plan.discountMonthlyValue,
    },
    yearly: {
      discountType: isPlanDiscountType(plan.discountYearlyType) ? plan.discountYearlyType : null,
      discountValue: plan.discountYearlyValue,
    },
  };
}

function assertPlanDiscounts(
  input: {
    discountMonthlyType?: PlanDiscountType | null;
    discountMonthlyValue?: number | null;
    discountYearlyType?: PlanDiscountType | null;
    discountYearlyValue?: number | null;
  },
  priceMonthly: number,
  priceYearly: number
) {
  const error =
    validatePlanDiscount(
      { discountType: input.discountMonthlyType ?? null, discountValue: input.discountMonthlyValue ?? null },
      priceMonthly,
      "monthly"
    ) ??
    validatePlanDiscount(
      { discountType: input.discountYearlyType ?? null, discountValue: input.discountYearlyValue ?? null },
      priceYearly,
      "yearly"
    );
  if (error) throw ApiError.badRequest(error);
}

// lucide-react/dynamic is a client module (its iconNames isn't usable on the server), so only the
// name format is checked here; the client renders a check mark for any name it doesn't know.
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Validated, normalized feature rows ready for the plans.features JSON column. */
function toFeaturesJson(features: PlanFeature[] | undefined): Prisma.InputJsonValue {
  const unknownIcon = features?.find((f) => !ICON_NAME.test(f.icon));
  if (unknownIcon) throw ApiError.badRequest(`Unknown icon '${unknownIcon.icon}'`);
  return normalizePlanFeatures(features ?? []) as unknown as Prisma.InputJsonValue;
}

function assertCostLimits(limits: { monthly: number | null; weekly: number | null; fiveHour: number | null }) {
  const error = validateCostLimits(limits);
  if (error) throw ApiError.badRequest(error);
}

function mapPlanToDto(
  plan: Prisma.PlanGetPayload<{
    include: {
      _count: { select: { users: true } };
      modelAccesses: { select: { catalogModelId: true } };
    };
  }>
): PlanDto {
  const { monthly, yearly } = readPlanDiscounts(plan);

  return {
    id: plan.id.toString(),
    slug: plan.slug,
    name: plan.name,
    description: plan.description,
    priceMonthly: plan.priceMonthly,
    priceYearly: plan.priceYearly,
    currency: plan.currency,
    discountMonthlyType: monthly.discountType,
    discountMonthlyValue: monthly.discountValue,
    discountYearlyType: yearly.discountType,
    discountYearlyValue: yearly.discountValue,
    effectivePriceMonthly: applyPlanDiscount(plan.priceMonthly, monthly),
    effectivePriceYearly: applyPlanDiscount(plan.priceYearly, yearly),
    monthlyCostLimitUsd: plan.monthlyCostLimitUsd != null ? toUsd(plan.monthlyCostLimitUsd) : null,
    weeklyCostLimitUsd: plan.weeklyCostLimitUsd != null ? toUsd(plan.weeklyCostLimitUsd) : null,
    fiveHourCostLimitUsd: plan.fiveHourCostLimitUsd != null ? toUsd(plan.fiveHourCostLimitUsd) : null,
    dailyRequestLimit: plan.dailyRequestLimit,
    requestsPerMinute: plan.requestsPerMinute,
    dailyUploadLimitMb: plan.dailyUploadLimitMb,
    dailyAgentUploadLimitMb: plan.dailyAgentUploadLimitMb,
    maxParallelRequests: plan.maxParallelRequests,
    badge: plan.badge,
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
    userCount: plan._count.users,
    allowedModelIds: plan.modelAccesses.map((m) => m.catalogModelId.toString()),
    features: normalizePlanFeatures(plan.features),
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

export async function listAdminPlans(): Promise<PlanDto[]> {
  const plans = await db.plan.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: {
      _count: { select: { users: true } },
      modelAccesses: { select: { catalogModelId: true } },
    },
  });

  return plans.map(mapPlanToDto);
}

export async function createAdminPlan(input: CreatePlanInput, actorUserId: bigint): Promise<PlanDto> {
  const existing = await db.plan.findUnique({
    where: { slug: input.slug },
  });

  if (existing) {
    throw ApiError.badRequest(`Plan with slug '${input.slug}' already exists.`);
  }

  const modelIds: bigint[] = [];
  for (const raw of input.allowedModelIds) {
    try {
      modelIds.push(BigInt(raw));
    } catch {
      throw ApiError.badRequest(`Invalid catalogModelId: ${raw}`);
    }
  }

  assertPlanDiscounts(input, input.priceMonthly, input.priceYearly);
  assertCostLimits({
    monthly: input.monthlyCostLimitUsd || null,
    weekly: input.weeklyCostLimitUsd || null,
    fiveHour: input.fiveHourCostLimitUsd || null,
  });

  const created = await db.$transaction(async (tx) => {
    const plan = await tx.plan.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        priceMonthly: input.priceMonthly,
        priceYearly: input.priceYearly,
        currency: input.currency,
        discountMonthlyType: input.discountMonthlyType ?? null,
        discountMonthlyValue: input.discountMonthlyValue ?? null,
        discountYearlyType: input.discountYearlyType ?? null,
        discountYearlyValue: input.discountYearlyValue ?? null,
        monthlyCostLimitUsd: input.monthlyCostLimitUsd || null,
        weeklyCostLimitUsd: input.weeklyCostLimitUsd || null,
        fiveHourCostLimitUsd: input.fiveHourCostLimitUsd || null,
        dailyRequestLimit: input.dailyRequestLimit ?? null,
        requestsPerMinute: input.requestsPerMinute ?? null,
        dailyUploadLimitMb: input.dailyUploadLimitMb || null,
        dailyAgentUploadLimitMb: input.dailyAgentUploadLimitMb || null,
        maxParallelRequests: input.maxParallelRequests || null,
        badge: input.badge ?? null,
        features: toFeaturesJson(input.features),
        isActive: input.isActive,
        sortOrder: input.sortOrder,
      },
    });

    if (modelIds.length > 0) {
      for (const mId of modelIds) {
        await tx.planModelAccess.create({
          data: {
            planId: plan.id,
            catalogModelId: mId,
          },
        });
      }
    }

    await recordAdminAudit(
      {
        actorUserId,
        action: "plan.create",
        entityType: "plan",
        entityId: plan.id.toString(),
        afterState: {
          slug: plan.slug,
          name: plan.name,
          priceMonthly: plan.priceMonthly,
          modelsCount: modelIds.length,
        },
      },
      tx
    );

    return tx.plan.findUniqueOrThrow({
      where: { id: plan.id },
      include: {
        _count: { select: { users: true } },
        modelAccesses: { select: { catalogModelId: true } },
      },
    });
  });

  await invalidateActiveCatalogCache();
  return mapPlanToDto(created);
}

export async function updateAdminPlan(
  id: bigint,
  input: UpdatePlanInput,
  actorUserId: bigint
): Promise<PlanDto> {
  const existing = await db.plan.findUnique({
    where: { id },
    include: {
      _count: { select: { users: true } },
      modelAccesses: { select: { catalogModelId: true } },
    },
  });

  if (!existing) {
    throw ApiError.notFound("Plan not found");
  }

  if (input.slug && input.slug !== existing.slug) {
    const conflict = await db.plan.findUnique({ where: { slug: input.slug } });
    if (conflict) {
      throw ApiError.badRequest(`Plan slug '${input.slug}' is already taken.`);
    }
  }

  // Validate against the values the plan will have after this partial update
  const current = readPlanDiscounts(existing);
  assertPlanDiscounts(
    {
      discountMonthlyType:
        input.discountMonthlyType !== undefined ? input.discountMonthlyType : current.monthly.discountType,
      discountMonthlyValue:
        input.discountMonthlyValue !== undefined ? input.discountMonthlyValue : current.monthly.discountValue,
      discountYearlyType:
        input.discountYearlyType !== undefined ? input.discountYearlyType : current.yearly.discountType,
      discountYearlyValue:
        input.discountYearlyValue !== undefined ? input.discountYearlyValue : current.yearly.discountValue,
    },
    input.priceMonthly ?? existing.priceMonthly,
    input.priceYearly ?? existing.priceYearly
  );
  assertCostLimits({
    monthly:
      input.monthlyCostLimitUsd !== undefined
        ? input.monthlyCostLimitUsd || null
        : costLimit(existing.monthlyCostLimitUsd),
    weekly:
      input.weeklyCostLimitUsd !== undefined
        ? input.weeklyCostLimitUsd || null
        : costLimit(existing.weeklyCostLimitUsd),
    fiveHour:
      input.fiveHourCostLimitUsd !== undefined
        ? input.fiveHourCostLimitUsd || null
        : costLimit(existing.fiveHourCostLimitUsd),
  });

  const updated = await db.$transaction(async (tx) => {
    const plan = await tx.plan.update({
      where: { id },
      data: {
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.priceMonthly !== undefined ? { priceMonthly: input.priceMonthly } : {}),
        ...(input.priceYearly !== undefined ? { priceYearly: input.priceYearly } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.discountMonthlyType !== undefined ? { discountMonthlyType: input.discountMonthlyType } : {}),
        ...(input.discountMonthlyValue !== undefined ? { discountMonthlyValue: input.discountMonthlyValue } : {}),
        ...(input.discountYearlyType !== undefined ? { discountYearlyType: input.discountYearlyType } : {}),
        ...(input.discountYearlyValue !== undefined ? { discountYearlyValue: input.discountYearlyValue } : {}),
        ...(input.monthlyCostLimitUsd !== undefined
          ? { monthlyCostLimitUsd: input.monthlyCostLimitUsd || null }
          : {}),
        ...(input.weeklyCostLimitUsd !== undefined
          ? { weeklyCostLimitUsd: input.weeklyCostLimitUsd || null }
          : {}),
        ...(input.fiveHourCostLimitUsd !== undefined
          ? { fiveHourCostLimitUsd: input.fiveHourCostLimitUsd || null }
          : {}),
        ...(input.dailyRequestLimit !== undefined ? { dailyRequestLimit: input.dailyRequestLimit } : {}),
        ...(input.requestsPerMinute !== undefined ? { requestsPerMinute: input.requestsPerMinute } : {}),
        ...(input.dailyUploadLimitMb !== undefined ? { dailyUploadLimitMb: input.dailyUploadLimitMb || null } : {}),
        ...(input.dailyAgentUploadLimitMb !== undefined
          ? { dailyAgentUploadLimitMb: input.dailyAgentUploadLimitMb || null }
          : {}),
        ...(input.maxParallelRequests !== undefined
          ? { maxParallelRequests: input.maxParallelRequests || null }
          : {}),
        ...(input.badge !== undefined ? { badge: input.badge } : {}),
        ...(input.features !== undefined ? { features: toFeaturesJson(input.features) } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });

    if (input.allowedModelIds !== undefined) {
      await tx.planModelAccess.deleteMany({
        where: { planId: id },
      });

      for (const raw of input.allowedModelIds) {
        try {
          const cId = BigInt(raw);
          await tx.planModelAccess.create({
            data: { planId: id, catalogModelId: cId },
          });
        } catch {
          throw ApiError.badRequest(`Invalid catalogModelId: ${raw}`);
        }
      }
    }

    await recordAdminAudit(
      {
        actorUserId,
        action: "plan.update",
        entityType: "plan",
        entityId: id.toString(),
        beforeState: {
          slug: existing.slug,
          name: existing.name,
          priceMonthly: existing.priceMonthly,
        },
        afterState: {
          slug: plan.slug,
          name: plan.name,
          priceMonthly: plan.priceMonthly,
        },
      },
      tx
    );

    return tx.plan.findUniqueOrThrow({
      where: { id },
      include: {
        _count: { select: { users: true } },
        modelAccesses: { select: { catalogModelId: true } },
      },
    });
  });

  await invalidateActiveCatalogCache();
  return mapPlanToDto(updated);
}

export async function deleteAdminPlan(id: bigint, actorUserId: bigint): Promise<void> {
  const existing = await db.plan.findUnique({
    where: { id },
    include: {
      _count: { select: { users: true } },
    },
  });

  if (!existing) {
    throw ApiError.notFound("Plan not found");
  }

  if (existing._count.users > 0) {
    throw ApiError.badRequest(
      `Cannot delete plan '${existing.name}' because ${existing._count.users} user(s) are currently assigned to it. Deactivate the plan or reassign the users first.`
    );
  }

  if (existing.slug === "free") {
    throw ApiError.badRequest("The default 'free' plan cannot be deleted.");
  }

  await db.$transaction(async (tx) => {
    await tx.plan.delete({
      where: { id },
    });

    await recordAdminAudit(
      {
        actorUserId,
        action: "plan.delete",
        entityType: "plan",
        entityId: id.toString(),
        beforeState: {
          slug: existing.slug,
          name: existing.name,
        },
      },
      tx
    );
  });

  await invalidateActiveCatalogCache();
}
