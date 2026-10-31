/** Client-safe plan discount helpers shared by the admin API and UI. */

export const PLAN_DISCOUNT_TYPES = ["percent", "flat"] as const;
export type PlanDiscountType = (typeof PLAN_DISCOUNT_TYPES)[number];

export interface PlanDiscount {
  discountType: PlanDiscountType | null;
  discountValue: number | null;
}

/** Returns error message if discount is invalid for the given base price (monthly or yearly), or null when valid. */
export function validatePlanDiscount(
  discount: PlanDiscount,
  basePrice: number,
  label: "monthly" | "yearly" = "monthly"
): string | null {
  const { discountType, discountValue } = discount;
  if (discountType == null) {
    return discountValue == null ? null : `Discount value for ${label} requires a discount type.`;
  }
  if (discountValue == null || !Number.isInteger(discountValue) || discountValue < 0) {
    return `Discount value for ${label} must be a non-negative whole number.`;
  }
  if (discountType === "percent" && discountValue > 100) {
    return `Percentage discount for ${label} must be between 0 and 100.`;
  }
  if (discountType === "flat" && discountValue > basePrice) {
    return `Flat discount for ${label} cannot exceed the ${label} price.`;
  }
  return null;
}

/** Applies a plan discount to a base price in the currency's integer units, never below zero. */
export function applyPlanDiscount(basePrice: number, discount: PlanDiscount): number {
  const { discountType, discountValue } = discount;
  if (discountType == null || discountValue == null || discountValue <= 0) return basePrice;
  const reduction =
    discountType === "percent"
      ? Math.round((basePrice * discountValue) / 100)
      : discountValue;
  return Math.max(0, basePrice - reduction);
}

export function isPlanDiscountType(value: unknown): value is PlanDiscountType {
  return typeof value === "string" && (PLAN_DISCOUNT_TYPES as readonly string[]).includes(value);
}
