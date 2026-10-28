import crypto from "node:crypto";

/**
 * Encrypts and decrypts secrets at rest (e.g. gateway API keys) using AES-256-GCM.
 * Payload layout: IV (12 bytes) + Auth Tag (16 bytes) + Ciphertext (N bytes)
 * Fits cleanly into MariaDB VARBINARY(1024).
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BYTES = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.GATEWAY_SECRET_KEY;
  if (!secret) {
    throw new Error(
      "GATEWAY_SECRET_KEY is not configured in environment. Cannot encrypt/decrypt gateway credentials."
    );
  }

  // Derive a 32-byte key via SHA-256 so arbitrary passphrases or hex strings work deterministically
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

/**
 * Encrypt a plaintext secret into a binary buffer containing IV + Tag + Ciphertext.
 */
export function encryptSecret(plaintext: string): Uint8Array<ArrayBuffer> {
  if (typeof plaintext !== "string") {
    throw new TypeError("Plaintext must be a string");
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Copy into a plain ArrayBuffer-backed view: that is what Prisma Bytes fields accept
  return new Uint8Array(Buffer.concat([iv, tag, ciphertext]));
}

/**
 * Decrypt a binary buffer containing IV + Tag + Ciphertext back into plaintext.
 */
export function decryptSecret(payload: Buffer | Uint8Array): string {
  if (!payload || payload.length < IV_LENGTH_BYTES + TAG_LENGTH_BYTES) {
    throw new Error("Invalid encrypted payload: buffer too short");
  }

  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const iv = buf.subarray(0, IV_LENGTH_BYTES);
  const tag = buf.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + TAG_LENGTH_BYTES);
  const ciphertext = buf.subarray(IV_LENGTH_BYTES + TAG_LENGTH_BYTES);

  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
