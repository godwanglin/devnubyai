import { db } from "@/lib/db";
import { recordAdminAudit } from "@/lib/admin/audit";
import { resolveAssetUrl } from "@/lib/storage/assets";
import { getCachedJson, setCachedJson } from "@/lib/redis/client";
import {
  CACHE_KEYS,
  CACHE_TTL,
  invalidatePaymentMethodsCache,
} from "@/lib/redis/cache-keys";
import { ApiError } from "@/lib/api/response";
import { findTripayChannel } from "@/lib/tripay/channels";
import type {
  PaymentMethodItem,
  PaymentMethodCategory,
  PaymentFlowType,
  PaymentProvider,
} from "./types";
import type { PaymentMethodCreateInput, PaymentMethodUpdateInput } from "./schemas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPaymentMethodItem(record: any): PaymentMethodItem {
  return {
    id: record.id.toString(),
    publicId: record.publicId,
    name: record.name,
    code: record.code,
    category: record.category as PaymentMethodCategory,
    provider: record.provider === "tripay" ? "tripay" : "doku",
    dokuCode: record.dokuCode,
    flowType: record.flowType as PaymentFlowType,
    imagePath: record.imagePath,
    imageUrl: resolveAssetUrl(record.imagePath),
    description: record.description,
    instructions: record.instructions,
    minAmount: Number(record.minAmount),
    maxAmount: record.maxAmount ? Number(record.maxAmount) : null,
    expiryDurationMinutes: Number(record.expiryDurationMinutes ?? 60),
    feeType: record.feeType as "none" | "flat" | "percent",
    feeValue: Number(record.feeValue),
    isActive: Boolean(record.isActive),
    sortOrder: Number(record.sortOrder),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * Tripay methods must use a channel the merchant has enabled at Tripay; category
 * and flow are derived from that channel, never picked by hand.
 */
async function enforceProviderRules(
  provider: PaymentProvider,
  channelCode: string | null | undefined
): Promise<{ category?: PaymentMethodCategory; flowType?: PaymentFlowType }> {
  if (provider !== "tripay") return {};
  if (!channelCode) {
    throw ApiError.badRequest("Channel code Tripay wajib dipilih");
  }
  let channel;
  try {
    channel = await findTripayChannel(channelCode);
  } catch (err) {
    throw ApiError.badRequest(
      `Gagal memuat channel Tripay: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }
  if (!channel) {
    throw ApiError.badRequest(`Channel '${channelCode}' tidak tersedia di akun merchant Tripay`);
  }
  return { category: channel.category, flowType: channel.flowType };
}

export async function listPaymentMethods(options?: {
  onlyActive?: boolean;
}): Promise<PaymentMethodItem[]> {
  if (options?.onlyActive) {
    const cached = await getCachedJson<PaymentMethodItem[]>(CACHE_KEYS.paymentMethodsActive());
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }
  }

  const records = await db.paymentMethod.findMany({
    where: options?.onlyActive ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });

  const items = records.map(toPaymentMethodItem);

  if (options?.onlyActive) {
    await setCachedJson(CACHE_KEYS.paymentMethodsActive(), items, CACHE_TTL.PAYMENT_METHODS);
  }

  return items;
}

export async function getPaymentMethodByPublicId(
  publicId: string
): Promise<PaymentMethodItem | null> {
  const record = await db.paymentMethod.findUnique({
    where: { publicId },
  });

  return record ? toPaymentMethodItem(record) : null;
}

export async function createPaymentMethod(
  input: PaymentMethodCreateInput,
  actorUserId?: bigint
): Promise<PaymentMethodItem> {
  const existing = await db.paymentMethod.findUnique({
    where: { code: input.code },
  });
  if (existing) {
    throw new Error(`Metode pembayaran dengan kode '${input.code}' sudah digunakan`);
  }

  const forced = await enforceProviderRules(input.provider, input.dokuCode);
  const created = await db.paymentMethod.create({
    data: {
      name: input.name,
      code: input.code,
      category: forced.category ?? input.category,
      provider: input.provider,
      dokuCode: input.dokuCode || null,
      flowType: forced.flowType ?? input.flowType,
      imagePath: input.imagePath || null,
      description: input.description || null,
      instructions: input.instructions || null,
      minAmount: input.minAmount,
      maxAmount: input.maxAmount || null,
      expiryDurationMinutes: input.expiryDurationMinutes ?? 60,
      feeType: input.feeType,
      feeValue: input.feeValue,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    },
  });

  if (actorUserId) {
    await recordAdminAudit({
      actorUserId,
      action: "payment_method.create",
      entityType: "payment_method",
      entityId: created.publicId,
      afterState: { name: created.name, code: created.code, isActive: created.isActive },
    });
  }

  await invalidatePaymentMethodsCache();

  return toPaymentMethodItem(created);
}

export async function updatePaymentMethod(
  publicId: string,
  input: PaymentMethodUpdateInput,
  actorUserId?: bigint
): Promise<PaymentMethodItem> {
  const current = await db.paymentMethod.findUnique({
    where: { publicId },
  });
  if (!current) {
    throw new Error("Metode pembayaran tidak ditemukan");
  }

  if (input.code && input.code !== current.code) {
    const duplicate = await db.paymentMethod.findUnique({
      where: { code: input.code },
    });
    if (duplicate) {
      throw new Error(`Kode '${input.code}' sudah digunakan metode lain`);
    }
  }

  const providerOrChannelChanged = input.provider !== undefined || input.dokuCode !== undefined;
  const forced = providerOrChannelChanged
    ? await enforceProviderRules(
        input.provider ?? (current.provider === "tripay" ? "tripay" : "doku"),
        input.dokuCode !== undefined ? input.dokuCode : current.dokuCode
      )
    : {};
  const category = forced.category ?? input.category;
  const flowType = forced.flowType ?? input.flowType;
  const updated = await db.paymentMethod.update({
    where: { publicId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
      ...(input.dokuCode !== undefined ? { dokuCode: input.dokuCode || null } : {}),
      ...(flowType !== undefined ? { flowType } : {}),
      ...(input.imagePath !== undefined ? { imagePath: input.imagePath || null } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      ...(input.instructions !== undefined ? { instructions: input.instructions || null } : {}),
      ...(input.minAmount !== undefined ? { minAmount: input.minAmount } : {}),
      ...(input.maxAmount !== undefined ? { maxAmount: input.maxAmount || null } : {}),
      ...(input.expiryDurationMinutes !== undefined
        ? { expiryDurationMinutes: input.expiryDurationMinutes }
        : {}),
      ...(input.feeType !== undefined ? { feeType: input.feeType } : {}),
      ...(input.feeValue !== undefined ? { feeValue: input.feeValue } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  });

  if (actorUserId) {
    await recordAdminAudit({
      actorUserId,
      action: "payment_method.update",
      entityType: "payment_method",
      entityId: publicId,
      beforeState: { name: current.name, code: current.code, isActive: current.isActive },
      afterState: { name: updated.name, code: updated.code, isActive: updated.isActive },
    });
  }

  await invalidatePaymentMethodsCache();

  return toPaymentMethodItem(updated);
}

export async function togglePaymentMethod(
  publicId: string,
  actorUserId?: bigint
): Promise<PaymentMethodItem> {
  const current = await db.paymentMethod.findUnique({
    where: { publicId },
  });
  if (!current) {
    throw new Error("Metode pembayaran tidak ditemukan");
  }

  const updated = await db.paymentMethod.update({
    where: { publicId },
    data: { isActive: !current.isActive },
  });

  if (actorUserId) {
    await recordAdminAudit({
      actorUserId,
      action: updated.isActive ? "payment_method.enable" : "payment_method.disable",
      entityType: "payment_method",
      entityId: publicId,
      beforeState: { isActive: current.isActive },
      afterState: { isActive: updated.isActive },
    });
  }

  await invalidatePaymentMethodsCache();

  return toPaymentMethodItem(updated);
}

export async function deletePaymentMethod(
  publicId: string,
  actorUserId?: bigint
): Promise<boolean> {
  const current = await db.paymentMethod.findUnique({
    where: { publicId },
  });
  if (!current) {
    throw new Error("Metode pembayaran tidak ditemukan");
  }

  await db.paymentMethod.delete({
    where: { publicId },
  });

  if (actorUserId) {
    await recordAdminAudit({
      actorUserId,
      action: "payment_method.delete",
      entityType: "payment_method",
      entityId: publicId,
      beforeState: { name: current.name, code: current.code },
    });
  }

  await invalidatePaymentMethodsCache();

  return true;
}
