import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { redis } from "@/lib/redis/client";

/**
 * Short-lived proof that the user entered their chat PIN. Issued as an
 * HttpOnly cookie after a correct PIN; locked chats are only served while it
 * is valid. One unlock opens all of the user's locked chats for 15 minutes.
 */
export const PIN_UNLOCK_COOKIE_NAME = "devnuby_pin_unlock";
const PIN_UNLOCK_TTL_SECONDS = 15 * 60;

const unlockKey = (token: string) =>
  `pin-unlock:${createHash("sha256").update(token).digest("hex")}`;

const localUnlocks = new Map<string, { userId: string; expiresAt: number }>();

export async function issuePinUnlock(userId: bigint): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const key = unlockKey(token);
  let stored = false;
  if (redis) {
    try {
      await redis.set(key, userId.toString(), "EX", PIN_UNLOCK_TTL_SECONDS);
      stored = true;
    } catch {
      // fall back to the per-process store
    }
  }
  if (!stored) {
    localUnlocks.set(key, { userId: userId.toString(), expiresAt: Date.now() + PIN_UNLOCK_TTL_SECONDS * 1000 });
  }

  const cookieStore = await cookies();
  cookieStore.set(PIN_UNLOCK_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PIN_UNLOCK_TTL_SECONDS,
  });
}

/** Ends the current unlock (e.g. right after locking a chat, so it hides at once). */
export async function revokePinUnlock(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PIN_UNLOCK_COOKIE_NAME)?.value;
  if (!token) return;
  const key = unlockKey(token);
  localUnlocks.delete(key);
  if (redis) {
    try {
      await redis.del(key);
    } catch {
      // the cookie is cleared below either way
    }
  }
  cookieStore.set(PIN_UNLOCK_COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function hasValidPinUnlock(userId: bigint): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PIN_UNLOCK_COOKIE_NAME)?.value;
  if (!token) return false;
  const key = unlockKey(token);

  if (redis) {
    try {
      const owner = await redis.get(key);
      if (owner !== null) return owner === userId.toString();
    } catch {
      // fall through to the per-process store
    }
  }
  const local = localUnlocks.get(key);
  if (!local || local.expiresAt <= Date.now()) {
    localUnlocks.delete(key);
    return false;
  }
  return local.userId === userId.toString();
}
