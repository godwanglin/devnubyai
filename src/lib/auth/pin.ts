import crypto from "crypto";

const PIN_SALT = process.env.APP_SECRET || "devnuby-pin-salt-secure";

export function hashPin(pin: string): string {
  return crypto
    .createHmac("sha256", PIN_SALT)
    .update(pin.trim())
    .digest("hex");
}

export function verifyPin(pin: string, storedHash: string): boolean {
  const computed = hashPin(pin);
  if (computed.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(computed, "hex"),
    Buffer.from(storedHash, "hex")
  );
}
