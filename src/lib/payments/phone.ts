/** Error code the checkout API returns when the gateway needs a phone number the user hasn't given */
export const PHONE_REQUIRED_CODE = "PHONE_REQUIRED";

/**
 * Normalizes an Indonesian mobile number to the local `08…` form.
 * Accepts `08…`, `628…` and `+628…` with spaces/dashes; returns null when invalid.
 */
export function normalizeIndonesianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("62")) digits = `0${digits.slice(2)}`;
  return /^08\d{8,12}$/.test(digits) ? digits : null;
}
