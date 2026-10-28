import { cookies } from "next/headers";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { createSession, OAUTH_STATE_COOKIE_NAME, OAUTH_VERIFIER_COOKIE_NAME } from "./session";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

function safeStringEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface GoogleTokens {
  access_token: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

/**
 * @param origin public origin from getPublicOrigin(); the authorize request and the
 * token exchange must derive it the same way so both redirect_uri values match.
 */
function getGoogleConfig(origin: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  return {
    clientId,
    clientSecret,
    redirectUri: `${origin}/api/v1/auth/google/callback`,
    isConfigured: Boolean(clientId && clientSecret),
  };
}

/**
 * Generate PKCE code verifier and code challenge (S256).
 */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/**
 * Build the Google OAuth authorization URL and set state + PKCE cookies.
 */
export async function getGoogleAuthorizationUrl(origin: string): Promise<string> {
  const config = getGoogleConfig(origin);
  if (!config.isConfigured || !config.clientId) {
    throw ApiError.badRequest(
      "Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
    );
  }

  const state = randomBytes(24).toString("base64url");
  const { verifier, challenge } = generatePkce();

  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 10 * 60, // 10 minutes
  };

  cookieStore.set(OAUTH_STATE_COOKIE_NAME, state, cookieOptions);
  cookieStore.set(OAUTH_VERIFIER_COOKIE_NAME, verifier, cookieOptions);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "online",
    prompt: "select_account",
  });

  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens, fetch user info, and upsert user + auth_account + session.
 */
export async function handleGoogleCallback(params: {
  code: string;
  state: string;
  origin: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{ userId: bigint; email: string }> {
  const config = getGoogleConfig(params.origin);
  if (!config.isConfigured || !config.clientId || !config.clientSecret) {
    throw ApiError.badRequest("Google OAuth is not configured.");
  }

  const cookieStore = await cookies();
  const savedState = cookieStore.get(OAUTH_STATE_COOKIE_NAME)?.value;
  const savedVerifier = cookieStore.get(OAUTH_VERIFIER_COOKIE_NAME)?.value;

  // Clear PKCE cookies immediately
  cookieStore.set(OAUTH_STATE_COOKIE_NAME, "", { maxAge: 0, path: "/" });
  cookieStore.set(OAUTH_VERIFIER_COOKIE_NAME, "", { maxAge: 0, path: "/" });

  if (!safeStringEqual(savedState, params.state)) {
    throw ApiError.badRequest("Invalid OAuth state (CSRF detected)");
  }

  if (!savedVerifier) {
    throw ApiError.badRequest("Missing PKCE code verifier");
  }

  // 1. Exchange code for access_token
  const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: params.code,
      code_verifier: savedVerifier,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error("[OAUTH_TOKEN_ERROR]", errorText);
    throw ApiError.badRequest("Failed to exchange Google authorization code");
  }

  const tokens = (await tokenResponse.json()) as GoogleTokens;

  // 2. Fetch user profile
  const userinfoResponse = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userinfoResponse.ok) {
    throw ApiError.badRequest("Failed to fetch Google user profile");
  }

  const profile = (await userinfoResponse.json()) as GoogleUserInfo;

  if (!profile.email) {
    throw ApiError.badRequest("Google account does not provide an email");
  }

  if (!profile.email_verified) {
    throw ApiError.badRequest("Google email is not verified");
  }

  const normalizedEmail = profile.email.toLowerCase().trim();
  const displayName = (profile.name || normalizedEmail.split("@")[0] || "User").slice(0, 120);
  const avatarUrl = profile.picture?.slice(0, 2048) ?? null;

  // 3. Find default free plan for new users
  const freePlan = await db.plan.findUnique({
    where: { slug: "free" },
  });

  // 4. Atomically upsert user and auth_account in transaction
  const user = await db.$transaction(async (tx) => {
    // Check if account already linked
    const existingAccount = await tx.authAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: "google",
          providerAccountId: profile.sub,
        },
      },
      include: { user: true },
    });

    if (existingAccount) {
      // Update existing user profile & last_login_at
      const updated = await tx.user.update({
        where: { id: existingAccount.userId },
        data: {
          name: displayName,
          avatarUrl: avatarUrl ?? existingAccount.user.avatarUrl,
          lastLoginAt: new Date(),
        },
      });
      return updated;
    }

    // Check if user with same email exists
    let targetUser = await tx.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (targetUser) {
      // Link Google account to existing user
      targetUser = await tx.user.update({
        where: { id: targetUser.id },
        data: {
          avatarUrl: avatarUrl ?? targetUser.avatarUrl,
          lastLoginAt: new Date(),
        },
      });
    } else {
      // Create new user with default free plan
      targetUser = await tx.user.create({
        data: {
          email: normalizedEmail,
          name: displayName,
          avatarUrl,
          role: "user",
          status: "active",
          planId: freePlan?.id ?? null,
          lastLoginAt: new Date(),
        },
      });
    }

    // Create auth_account record
    await tx.authAccount.create({
      data: {
        userId: targetUser.id,
        provider: "google",
        providerAccountId: profile.sub,
      },
    });

    return targetUser;
  });

  // 5. Create session in DB and set cookie
  await createSession({
    userId: user.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  return { userId: user.id, email: user.email };
}
