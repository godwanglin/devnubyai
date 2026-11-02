import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { hashPin, isLegacyPinHash, verifyPin } from "@/lib/auth/pin";
import { invalidateUserMeCache } from "@/lib/redis/cache-keys";
import { incrementRateCounter, resetRateCounter } from "@/lib/api/rate-limit";
import { issuePinUnlock } from "@/lib/auth/pin-unlock";

const MAX_FAILED_PIN_ATTEMPTS = 5;
const FAILED_PIN_WINDOW_SECONDS = 15 * 60;

const pinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "PIN harus berupa 4 digit angka"),
});

const setPinSchema = pinSchema.extend({
  currentPin: z.string().regex(/^\d{4}$/).optional(),
});

/**
 * Verifies a PIN against the stored hash with the shared wrong-guess cap
 * (a 4-digit PIN falls to brute force otherwise); upgrades legacy hashes.
 */
async function checkPin(userId: bigint, pin: string, storedHash: string): Promise<boolean> {
  const rateKey = `rate:pin-fail:${userId}`;
  if ((await incrementRateCounter(rateKey, FAILED_PIN_WINDOW_SECONDS)) > MAX_FAILED_PIN_ATTEMPTS) {
    throw ApiError.rateLimited("Terlalu banyak percobaan PIN. Coba lagi dalam 15 menit.");
  }
  if (!verifyPin(pin, storedHash)) return false;

  await resetRateCounter(rateKey);
  if (isLegacyPinHash(storedHash)) {
    await db.user.update({ where: { id: userId }, data: { chatPinHash: hashPin(pin) } });
  }
  return true;
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { chatPinHash: true },
    });

    return jsonSuccess({ hasPin: Boolean(dbUser?.chatPinHash) }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({}));
    const parsed = setPinSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message || "PIN tidak valid");
    }

    // Replacing an existing PIN requires the current one
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { chatPinHash: true },
    });
    if (dbUser?.chatPinHash) {
      if (!parsed.data.currentPin) {
        throw ApiError.badRequest("PIN lama wajib diisi");
      }
      if (!(await checkPin(user.id, parsed.data.currentPin, dbUser.chatPinHash))) {
        throw ApiError.badRequest("PIN lama salah");
      }
    }

    const hashed = hashPin(parsed.data.pin);

    await db.user.update({
      where: { id: user.id },
      data: { chatPinHash: hashed },
    });

    await invalidateUserMeCache(user.id);

    return jsonSuccess({ success: true, hasPin: true }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function PUT(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({}));
    const parsed = pinSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message || "PIN tidak valid");
    }

    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { chatPinHash: true },
    });

    if (!dbUser?.chatPinHash) {
      throw ApiError.badRequest("PIN belum diatur");
    }

    const isValid = await checkPin(user.id, parsed.data.pin, dbUser.chatPinHash);
    // A correct PIN unlocks the user's locked chats for a short while (HttpOnly cookie)
    if (isValid) await issuePinUnlock(user.id);
    return jsonSuccess({ valid: isValid }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
