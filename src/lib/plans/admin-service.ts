import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { recordAdminAudit } from "@/lib/admin/audit";
import { invalidateActiveCatalogCache } from "@/lib/catalog/cache";
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
  // 0 or null means the window has no limit.
  monthlyTokenLimit: z.number().int().min(0).optional().nullable(),
  weeklyTokenLimit: z.number().int().min(0).optional().nullable(),
  fiveHourTokenLimit: z.number().int().min(0).optional().nullable(),
  dailyRequestLimit: z.number().int().positive().optional().nullable(),
  requestsPerMinute: z.number().int().positive().optional().nullable(),
  badge: z.string().trim().max(32).optional().nullable(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(65535).default(100),
  allowedModelIds: z.array(z.string()).default([]),
});

export const updatePlanSchema = createPlanSchema.partial();

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
  monthlyTokenLimit: number | null;
  weeklyTokenLimit: number | null;
  fiveHourTokenLimit: number | null;
  dailyRequestLimit: number | null;
  requestsPerMinute: number | null;
  badge: string | null;
  isActive: boolean;
  sortOrder: number;
  userCount: number;
  allowedModelIds: string[];
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
    monthlyTokenLimit: plan.monthlyTokenLimit != null ? Number(plan.monthlyTokenLimit) : null,
    weeklyTokenLimit: plan.weeklyTokenLimit != null ? Number(plan.weeklyTokenLimit) : null,
    fiveHourTokenLimit: plan.fiveHourTokenLimit != null ? Number(plan.fiveHourTokenLimit) : null,
    dailyRequestLimit: plan.dailyRequestLimit,
    requestsPerMinute: plan.requestsPerMinute,
    badge: plan.badge,
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
    userCount: plan._count.users,
    allowedModelIds: plan.modelAccesses.map((m) => m.catalogModelId.toString()),
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
        monthlyTokenLimit: input.monthlyTokenLimit ? BigInt(input.monthlyTokenLimit) : null,
        weeklyTokenLimit: input.weeklyTokenLimit ? BigInt(input.weeklyTokenLimit) : null,
        fiveHourTokenLimit: input.fiveHourTokenLimit ? BigInt(input.fiveHourTokenLimit) : null,
        dailyRequestLimit: input.dailyRequestLimit ?? null,
        requestsPerMinute: input.requestsPerMinute ?? null,
        badge: input.badge ?? null,
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
        ...(input.monthlyTokenLimit !== undefined
          ? { monthlyTokenLimit: input.monthlyTokenLimit ? BigInt(input.monthlyTokenLimit) : null }
          : {}),
        ...(input.weeklyTokenLimit !== undefined
          ? { weeklyTokenLimit: input.weeklyTokenLimit ? BigInt(input.weeklyTokenLimit) : null }
          : {}),
        ...(input.fiveHourTokenLimit !== undefined
          ? { fiveHourTokenLimit: input.fiveHourTokenLimit ? BigInt(input.fiveHourTokenLimit) : null }
          : {}),
        ...(input.dailyRequestLimit !== undefined ? { dailyRequestLimit: input.dailyRequestLimit } : {}),
        ...(input.requestsPerMinute !== undefined ? { requestsPerMinute: input.requestsPerMinute } : {}),
        ...(input.badge !== undefined ? { badge: input.badge } : {}),
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
