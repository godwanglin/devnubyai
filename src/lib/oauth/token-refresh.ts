import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto/vault";
import { XAI_CLIENT_ID, XAI_TOKEN_URL } from "./constants/xai";
import { OPENAI_OAUTH_CLIENT_ID, OPENAI_TOKEN_URL } from "./constants/openai";
import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
  GOOGLE_OAUTH_TOKEN_URL,
} from "./constants/antigravity";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

// In-process lock to prevent duplicate simultaneous refresh requests for the same connection
const activeRefreshes = new Map<string, Promise<string>>();

/**
 * Checks if a connection's access token needs refreshing (or already expired).
 * Defaults to refreshing 5 minutes before expiration.
 */
export function needsTokenRefresh(expiresAt: Date | null, leadSeconds = 300): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() - leadSeconds * 1000 <= Date.now();
}

/**
 * Perform OAuth refresh_token grant against the provider's auth endpoint:
 * xAI (`xai`, `grok-cli`), auth.openai.com (`openai`) or Google (`antigravity`).
 */
export async function refreshConnectionToken(
  connectionId: bigint,
  options?: { force?: boolean }
): Promise<string> {
  const connKey = connectionId.toString();

  // Deduplicate concurrent refresh calls for the same connection
  const inFlight = activeRefreshes.get(connKey);
  if (inFlight) return inFlight;

  const refreshPromise = (async () => {
    try {
      const conn = await db.providerConnection.findUnique({
        where: { id: connectionId },
        select: {
          id: true,
          accessTokenCiphertext: true,
          refreshTokenCiphertext: true,
          expiresAt: true,
          gateway: { select: { oauthProvider: true } },
        },
      });

      if (!conn) {
        throw new Error(`Connection ${connectionId} not found`);
      }

      // If not forced and still fresh, return current token
      if (!options?.force && !needsTokenRefresh(conn.expiresAt)) {
        return decryptSecret(conn.accessTokenCiphertext);
      }

      if (!conn.refreshTokenCiphertext) {
        // No refresh token available, return existing access token
        return decryptSecret(conn.accessTokenCiphertext);
      }

      const refreshToken = decryptSecret(conn.refreshTokenCiphertext);

      const provider = conn.gateway?.oauthProvider;
      const isOpenAi = provider === "openai";
      const isAntigravity = provider === "antigravity";
      const tokenUrl = isAntigravity ? GOOGLE_OAUTH_TOKEN_URL : isOpenAi ? OPENAI_TOKEN_URL : XAI_TOKEN_URL;
      const clientId = isAntigravity ? ANTIGRAVITY_CLIENT_ID : isOpenAi ? OPENAI_OAUTH_CLIENT_ID : XAI_CLIENT_ID;

      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refreshToken,
      });
      // Google's installed-app client requires its (public) client secret on refresh
      if (isAntigravity) body.set("client_secret", ANTIGRAVITY_CLIENT_SECRET);

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
      });

      const data = (await response.json().catch(() => ({}))) as TokenResponse;

      if (!response.ok || !data.access_token) {
        // OpenAI returns error as an object ({ message, code }), xAI as a string
        const rawError = data.error as unknown;
        const errorText =
          rawError && typeof rawError === "object" ? (rawError as { message?: string }).message : rawError;
        const errorMsg = data.error_description || (errorText ? String(errorText) : `HTTP ${response.status}`);
        await db.providerConnection.update({
          where: { id: connectionId },
          data: { lastError: `Refresh token failed: ${errorMsg}` },
        });
        throw new Error(`Token refresh failed: ${errorMsg}`);
      }

      const newAccessTokenCiphertext = encryptSecret(data.access_token);
      const newExpiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : null;

      const updateData: {
        accessTokenCiphertext: Uint8Array<ArrayBuffer>;
        expiresAt: Date | null;
        lastError: null;
        refreshTokenCiphertext?: Uint8Array<ArrayBuffer>;
      } = {
        accessTokenCiphertext: newAccessTokenCiphertext,
        expiresAt: newExpiresAt,
        lastError: null,
      };

      if (data.refresh_token) {
        updateData.refreshTokenCiphertext = encryptSecret(data.refresh_token);
      }

      await db.providerConnection.update({
        where: { id: connectionId },
        data: updateData,
      });

      return data.access_token;
    } finally {
      activeRefreshes.delete(connKey);
    }
  })();

  activeRefreshes.set(connKey, refreshPromise);
  return refreshPromise;
}

/**
 * Decode payload email from id_token or JWT access_token without verifying signature.
 */
export function extractEmailFromToken(jwtToken?: string | null): string | null {
  if (!jwtToken) return null;
  try {
    const parts = jwtToken.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof payload.email === "string" && payload.email) return payload.email;
    if (typeof payload["https://api.x.ai/email"] === "string") return payload["https://api.x.ai/email"];
    return null;
  } catch {
    return null;
  }
}

/**
 * Decode upstream user ID / sub from JWT token.
 */
export function extractUserIdFromToken(jwtToken?: string | null): string | null {
  if (!jwtToken) return null;
  try {
    const parts = jwtToken.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof payload.sub === "string" && payload.sub) return payload.sub;
    if (typeof payload.userId === "string") return payload.userId;
    return null;
  } catch {
    return null;
  }
}
