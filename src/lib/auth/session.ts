import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
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

/**
 * Validate a raw session token string against the database.
 */
export async function validateSessionToken(rawToken: string): Promise<SessionContext | null> {
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

  if (!session) return null;

  // Check expiration
  if (session.expiresAt.getTime() <= Date.now()) {
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
    return null;
  }

  return {
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
      planId: session.user.planId,
      plan: session.user.plan,
    },
  };
}

/**
 * Guard that requires an authenticated user.
 * Throws ApiError.unauthorized() if unauthenticated.
 */
export async function requireUser(): Promise<SessionUser> {
  const ctx = await getSession();
  if (!ctx) {
    throw ApiError.unauthorized("Authentication required");
  }
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
    },
  });

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
    const tokenHash = hashSessionToken(token);
    try {
      await db.authSession.deleteMany({
        where: { tokenHash },
      });
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
