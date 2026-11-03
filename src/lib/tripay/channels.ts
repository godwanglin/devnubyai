import { getCachedJson, setCachedJson, invalidateCacheKey } from "@/lib/redis/client";
import type { PaymentFlowType, PaymentMethodCategory } from "@/lib/payments/types";
import { getTripayConfig } from "./config";
import { listTripayChannels } from "./client";
import type { TripayChannel, TripayPaymentKind } from "./types";

const CHANNELS_CACHE_KEY = "cache:tripay:channels";
const CHANNELS_CACHE_TTL = 600; // 10 minutes; Tripay channel set changes rarely

export interface TripayChannelOption {
  code: string;
  name: string;
  group: string;
  type: string;
  iconUrl: string | null;
  minAmount: number | null;
  maxAmount: number | null;
  feeFlat: number;
  feePercent: number;
  active: boolean;
  kind: TripayPaymentKind;
  category: PaymentMethodCategory;
  flowType: PaymentFlowType;
}

/**
 * Derives how a channel is paid from Tripay's own metadata:
 * `redirect` channels go through Tripay's hosted page, QRIS returns a QR payload,
 * every other direct channel (VA, convenience store) returns a pay code.
 */
export function classifyTripayChannel(
  channel: Pick<TripayChannel, "code" | "group" | "type">
): { kind: TripayPaymentKind; category: PaymentMethodCategory; flowType: PaymentFlowType } {
  const group = channel.group.toLowerCase();
  if (channel.type === "redirect") {
    return { kind: "redirect", category: "ewallet", flowType: "checkout" };
  }
  if (channel.code.toUpperCase().startsWith("QRIS")) {
    return { kind: "qris", category: "qris", flowType: "direct" };
  }
  if (group.includes("virtual account")) {
    return { kind: "pay_code", category: "virtual_account", flowType: "direct" };
  }
  if (group.includes("convenience") || group.includes("retail")) {
    return { kind: "pay_code", category: "retail", flowType: "direct" };
  }
  if (group.includes("wallet")) {
    return { kind: "pay_code", category: "ewallet", flowType: "direct" };
  }
  return { kind: "pay_code", category: "virtual_account", flowType: "direct" };
}

function toOption(channel: TripayChannel): TripayChannelOption {
  return {
    code: channel.code,
    name: channel.name,
    group: channel.group,
    type: channel.type,
    iconUrl: channel.icon_url || null,
    minAmount: channel.minimum_amount ?? null,
    maxAmount: channel.maximum_amount ?? null,
    feeFlat: Number(channel.fee_customer?.flat) || 0,
    feePercent: Number(channel.fee_customer?.percent) || 0,
    active: Boolean(channel.active),
    ...classifyTripayChannel(channel),
  };
}

/** Merchant's Tripay channels, cached in Redis */
export async function getTripayChannels(options?: {
  forceRefresh?: boolean;
}): Promise<TripayChannelOption[]> {
  if (!options?.forceRefresh) {
    const cached = await getCachedJson<TripayChannelOption[]>(CHANNELS_CACHE_KEY);
    if (cached && Array.isArray(cached) && cached.length > 0) return cached;
  }

  const channels = (await listTripayChannels(getTripayConfig())).map(toOption);
  await setCachedJson(CHANNELS_CACHE_KEY, channels, CHANNELS_CACHE_TTL);
  return channels;
}

export async function invalidateTripayChannelsCache(): Promise<void> {
  await invalidateCacheKey(CHANNELS_CACHE_KEY);
}

export async function findTripayChannel(code: string): Promise<TripayChannelOption | null> {
  const channels = await getTripayChannels();
  return channels.find((c) => c.code === code) ?? null;
}
