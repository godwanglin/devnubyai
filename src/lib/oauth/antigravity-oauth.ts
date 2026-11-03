import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
  ANTIGRAVITY_LOAD_CODE_ASSIST_URL,
  ANTIGRAVITY_REDIRECT_URI,
  ANTIGRAVITY_SCOPES,
  ANTIGRAVITY_USER_AGENT,
  GOOGLE_OAUTH_AUTH_URL,
  GOOGLE_OAUTH_TOKEN_URL,
} from "./constants/antigravity";
import { generatePKCE } from "./pkce";
import { extractEmailFromToken, extractUserIdFromToken } from "./token-refresh";
import type { TokenExchangeResult } from "./providers";

/** Builds Google OAuth2 authorize URL with offline access and full Antigravity scopes */
export function buildAntigravityAuthorizeUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: ANTIGRAVITY_CLIENT_ID,
    response_type: "code",
    redirect_uri: ANTIGRAVITY_REDIRECT_URI,
    scope: ANTIGRAVITY_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${GOOGLE_OAUTH_AUTH_URL}?${params.toString()}`;
}

export function startAntigravityPkceFlow(): {
  authUrl: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
} {
  const { codeVerifier, codeChallenge, state } = generatePKCE(96);
  return {
    authUrl: buildAntigravityAuthorizeUrl(state, codeChallenge),
    state,
    codeVerifier,
    redirectUri: ANTIGRAVITY_REDIRECT_URI,
  };
}

/**
 * Fetch Google Cloud Companion Project ID via loadCodeAssist on production endpoint.
 * This project ID is mandatory for Antigravity requests envelope.
 */
export async function fetchAntigravityProjectId(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(ANTIGRAVITY_LOAD_CODE_ASSIST_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": ANTIGRAVITY_USER_AGENT,
      },
      body: JSON.stringify({
        metadata: {
          ideType: 9,
          platform: 2,
          pluginType: 2,
        },
      }),
    });

    if (!res.ok) {
      console.warn(`[ANTIGRAVITY_PROJECT_FETCH_FAILED] HTTP ${res.status}`);
      return null;
    }

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // Shape: { cloudaicompanionProject: { id: "..." } } or string
    const companion = json.cloudaicompanionProject as Record<string, unknown> | string | undefined;
    if (typeof companion === "string" && companion.trim()) {
      return companion.trim();
    }
    if (companion && typeof companion === "object" && typeof companion.id === "string" && companion.id.trim()) {
      return companion.id.trim();
    }
    return null;
  } catch (err) {
    console.warn("[ANTIGRAVITY_PROJECT_FETCH_ERROR]", err);
    return null;
  }
}

/** Exchange authorization code for tokens at oauth2.googleapis.com */
export async function exchangeAntigravityCode(
  code: string,
  codeVerifier: string,
  redirectUri: string = ANTIGRAVITY_REDIRECT_URI
): Promise<TokenExchangeResult> {
  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== "string") {
    const errObj = json.error as Record<string, unknown> | string | undefined;
    const err =
      (typeof errObj === "object" ? errObj?.message : errObj) ||
      json.error_description ||
      `HTTP ${res.status}`;
    throw new Error(`Antigravity token exchange failed: ${String(err)}`);
  }

  const accessToken = String(json.access_token);
  const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : undefined;
  const idToken = typeof json.id_token === "string" ? json.id_token : undefined;
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : undefined;
  const scope = typeof json.scope === "string" ? json.scope : undefined;

  const email = extractEmailFromToken(idToken) || extractEmailFromToken(accessToken);
  const upstreamUserId = extractUserIdFromToken(idToken) || extractUserIdFromToken(accessToken);

  // Discover Project ID immediately
  const projectId = await fetchAntigravityProjectId(accessToken);

  return {
    accessToken,
    refreshToken,
    idToken,
    expiresIn,
    scope,
    email,
    upstreamUserId,
    providerData: {
      authMethod: "pkce",
      projectId: projectId ?? null,
      idToken: idToken ?? null,
    },
  };
}
