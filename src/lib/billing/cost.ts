import { Prisma } from "@/generated/client";

/**
 * Usage is billed in USD from the catalog model's per-1M-token prices.
 * Decimal math end to end: summing many tiny per-request costs in floats drifts.
 */
const ONE_MILLION = new Prisma.Decimal(1_000_000);

type DecimalInput = Prisma.Decimal | number | string;

/** Cost of one reply: prompt × input price + completion × output price, per 1M tokens. */
export function computeCostUsd(
  promptTokens: number,
  completionTokens: number,
  inputPricePerMillion: DecimalInput,
  outputPricePerMillion: DecimalInput
): Prisma.Decimal {
  const prompt = new Prisma.Decimal(Math.max(0, Math.floor(promptTokens)));
  const completion = new Prisma.Decimal(Math.max(0, Math.floor(completionTokens)));
  return prompt
    .mul(inputPricePerMillion)
    .add(completion.mul(outputPricePerMillion))
    .div(ONE_MILLION);
}

// Also accepts strings/numbers: a Decimal that went through JSON (cache) comes back as a string
function asNumber(value: DecimalInput): number {
  return new Prisma.Decimal(value).toNumber();
}

/** Spend cap as a plain number of dollars; null when the window has no limit (null or 0). */
export function costLimit(value: DecimalInput | null | undefined): number | null {
  if (value == null) return null;
  const n = asNumber(value);
  return n > 0 ? n : null;
}

/** Decimal dollars → number rounded to micro-dollars, for JSON and comparisons. */
export function toUsd(value: DecimalInput | null | undefined): number {
  if (value == null) return 0;
  return Math.round(asNumber(value) * 1_000_000) / 1_000_000;
}
