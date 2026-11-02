import crypto from "crypto";
import { hashPassword, verifyPassword } from "./password";

// Legacy hashes were an HMAC under one global key (often this public default)
const LEGACY_PIN_SALT = process.env.APP_SECRET || "devnuby-pin-salt-secure";

function legacyHashPin(pin: string): string {
  return crypto.createHmac("sha256", LEGACY_PIN_SALT).update(pin.trim()).digest("hex");
}

/** New PINs use scrypt with a per-user random salt, like passwords ("salt:key"). */
export function hashPin(pin: string): string {
  return hashPassword(pin.trim());
}

/** True for pre-scrypt hashes that should be replaced after a successful verify. */
export function isLegacyPinHash(storedHash: string): boolean {
  return !storedHash.includes(":");
}

export function verifyPin(pin: string, storedHash: string): boolean {
  if (!isLegacyPinHash(storedHash)) {
    return verifyPassword(pin.trim(), storedHash);
  }
  const computed = legacyHashPin(pin);
  if (computed.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(computed, "hex"),
    Buffer.from(storedHash, "hex")
  );
}
