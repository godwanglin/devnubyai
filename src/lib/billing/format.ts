/** Client-safe USD formatting for usage and plan limits. */
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const smallUsdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** "$5.00", and up to 4 decimals below one dollar so tiny spend stays visible ("$0.0042"). */
export function formatUsd(amount: number): string {
  return Math.abs(amount) < 1 ? smallUsdFormatter.format(amount) : usdFormatter.format(amount);
}
