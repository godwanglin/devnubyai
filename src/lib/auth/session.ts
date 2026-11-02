import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { invalidateUserSessionsCache, invalidateUserMeCache } from "@/lib/redis/cache-keys";
import { redis } from "@/lib/redis/client";
import { FREE_PLAN_SLUG, isPlanExpired } from "@/lib/plans/effective-plan";
import type { Plan } from "@/generated/client";

export const SESSION_COOKIE_NAME = "devnuby_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const OAUTH_STATE_COOKIE_NAME = "devnuby_oauth_state";
export const OAUTH_VERIFIER_COOKIE_NAME = "devnuby_oauth_verifier";

/**
 * SHA-256 hash of a raw session token.
 * Output is 32 bytes matching `auth_sessions.token_hash BINARY(32)`
 * (Prisma 7 Bytes fields expect a plain ArrayBuffer-backed Uint8Array).
 */
export function hashSessionToken(rawToken: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash("sha256").update(rawToken).digest());
}

/**
 * Generate a cryptographically secure random session token string (hex or base64url).
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface SessionUser {
  id: bigint;
  publicId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  status: string;
  planId: bigint | null;
  plan: Plan | null;
  /** Expiry of the purchased plan (null = none); `plan` is already the effective one */
  planExpiresAt: Date | null;
}

export interface SessionContext {
  user: SessionUser;
  sessionId: bigint;
  expiresAt: Date;
}

/**
 * Read the current session from incoming cookies (via next/headers cookies()).
 * Validates token_hash in auth_sessions and checks expiration (Q12).
 * Returns null if missing or expired.
 */
export async function getSession(): Promise<SessionContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  return validateSessionToken(token);
}

interface CachedSessionContext {
  ctx: SessionContext;
  expiresAt: number;
  cachedAt: number;
}

const sessionL1Cache = new Map<string, CachedSessionContext>();

const SESSION_L1_TTL_MS = 20_000;
const revokedAtKey = (userId: bigint) => `auth:revoked-at:${userId}`;

/**
 * Marks every cached session of a user as stale on all instances, so a revoked
 * session (logout elsewhere, password change, suspension) stops working at once
 * instead of surviving in another process's L1 cache for up to 20s.
 */
export async function markUserSessionsRevoked(userId: bigint): Promise<void> {
  for (const [token, entry] of sessionL1Cache) {
    if (entry.ctx.user.id === userId) sessionL1Cache.delete(token);
  }
  if (!redis) return;
  try {
    await redis.set(revokedAtKey(userId), String(Date.now()), "EX", Math.ceil(SESSION_L1_TTL_MS / 1000) * 3);
  } catch {
    // best effort: falls back to the short L1 TTL
  }
}

async function isRevokedSince(userId: bigint, cachedAt: number): Promise<boolean> {
  if (!redis) return false;
  try {
    const raw = await redis.get(revokedAtKey(userId));
    return raw !== null && Number(raw) >= cachedAt;
  } catch {
    return false;
  }
}

export function invalidateSessionTokenCache(rawToken?: string): void {
  if (rawToken) {
    sessionL1Cache.delete(rawToken);
  } else {
    sessionL1Cache.clear();
  }
}

/**
 * Validate a raw session token string against the database.
 */
export async function validateSessionToken(rawToken: string): Promise<SessionContext | null> {
  const now = Date.now();
  const cached = sessionL1Cache.get(rawToken);
  if (cached && now < cached.expiresAt && cached.ctx.expiresAt.getTime() > now) {
    if (!(await isRevokedSince(cached.ctx.user.id, cached.cachedAt))) {
      return cached.ctx;
    }
    sessionL1Cache.delete(rawToken);
  }

  const tokenHash = hashSessionToken(rawToken);

  const session = await db.authSession.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          plan: true,
        },
      },
    },
  });

  if (!session) {
    sessionL1Cache.delete(rawToken);
    return null;
  }

  // Check expiration
  if (session.expiresAt.getTime() <= now) {
    sessionL1Cache.delete(rawToken);
    // Lazy purge expired session
    try {
      await db.authSession.delete({ where: { id: session.id } });
    } catch {
      // ignore concurrent delete
    }
    return null;
  }

  // Check user status
  if (session.user.status !== "active") {
    sessionL1Cache.delete(rawToken);
    return null;
  }

  // An expired paid plan behaves as the free plan everywhere the session plan is read
  let { planId, plan } = session.user;
  if (isPlanExpired(session.user.planExpiresAt, now)) {
    plan = await db.plan.findUnique({ where: { slug: FREE_PLAN_SLUG } });
    planId = plan?.id ?? null;
  }

  const ctx: SessionContext = {
    sessionId: session.id,
    expiresAt: session.expiresAt,
    user: {
      id: session.user.id,
      publicId: session.user.publicId,
      email: session.user.email,
      name: session.user.name,
      avatarUrl: session.user.avatarUrl,
      role: session.user.role,
      status: session.user.status,
      planId,
      plan,
      planExpiresAt: session.user.planExpiresAt,
    },
  };

  sessionL1Cache.set(rawToken, {
    ctx,
    expiresAt: Math.min(now + SESSION_L1_TTL_MS, session.expiresAt.getTime()),
    cachedAt: now,
  });

  return ctx;
}

/**
 * Guard that requires an authenticated user session context.
 * Throws ApiError.unauthorized() if unauthenticated.
 */
export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSession();
  if (!ctx) {
    throw ApiError.unauthorized("Authentication required");
  }
  return ctx;
}

/**
 * Guard that requires an authenticated user.
 * Throws ApiError.unauthorized() if unauthenticated.
 */
export async function requireUser(): Promise<SessionUser> {
  const ctx = await requireSession();
  return ctx.user;
}

/**
 * Guard that requires an active admin user.
 * Throws ApiError.unauthorized() or ApiError.forbidden().
 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw ApiError.forbidden("Admin access required");
  }
  return user;
}

/**
 * Create a new session in DB and set the HttpOnly cookie.
 */
export async function createSession(params: {
  userId: bigint;
  ipAddress?: string | null;
  userAgent?: string | null;
  location?: string | null;
}): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await db.authSession.create({
    data: {
      userId: params.userId,
      tokenHash,
      expiresAt,
      ipAddress: params.ipAddress?.slice(0, 45) ?? null,
      userAgent: params.userAgent?.slice(0, 512) ?? null,
      location: params.location?.slice(0, 128) ?? null,
    },
  });

  await invalidateUserSessionsCache(params.userId);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return { rawToken, expiresAt };
}

/**
 * Destroy the current session in DB and clear the cookie.
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    invalidateSessionTokenCache(token);
    const tokenHash = hashSessionToken(token);
    try {
      const s = await db.authSession.findUnique({
        where: { tokenHash },
        select: { userId: true },
      });
      await db.authSession.deleteMany({
        where: { tokenHash },
      });
      if (s) {
        await Promise.allSettled([
          invalidateUserSessionsCache(s.userId),
          invalidateUserMeCache(s.userId),
          markUserSessionsRevoked(s.userId),
        ]);
      }
    } catch {
      // ignore
    }
  }

  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}
