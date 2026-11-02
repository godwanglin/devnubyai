/**
 * Plan spend caps (USD). Monthly is the budget; weekly and five-hour only pace
 * it, so a shorter window can never allow more than a longer one.
 * Isomorphic: shared by the admin plan form and the plans service.
 */
export interface PlanCostLimits {
  monthly: number | null;
  weekly: number | null;
  fiveHour: number | null;
}

/** Form text → dollars; empty, invalid or 0 means "no limit" (null). */
export function parseCostLimit(raw: string): number | null {
  const value = Number(raw.trim());
  return raw.trim() !== "" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Form text → whole request count; empty, invalid or 0 means "no limit" (null). */
export function parseCountLimit(raw: string): number | null {
  const value = Math.floor(Number(raw.trim()));
  return raw.trim() !== "" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Returns an error message when a shorter window exceeds a longer one. */
export function validateCostLimits(limits: PlanCostLimits): string | null {
  const { monthly, weekly, fiveHour } = limits;
  if (monthly !== null && weekly !== null && weekly > monthly) {
    return "Weekly limit cannot exceed the monthly limit.";
  }
  const fiveHourCap = weekly ?? monthly;
  if (fiveHourCap !== null && fiveHour !== null && fiveHour > fiveHourCap) {
    return weekly !== null
      ? "5-hour limit cannot exceed the weekly limit."
      : "5-hour limit cannot exceed the monthly limit.";
  }
  return null;
}
