import {
  OPENAI_AUTH_URL,
  OPENAI_EXTRA_AUTH_PARAMS,
  OPENAI_OAUTH_CLIENT_ID,
  OPENAI_REDIRECT_URI,
  OPENAI_SCOPE,
  OPENAI_TOKEN_URL,
} from "./constants/openai";
import { generatePKCE } from "./pkce";
import { extractEmailFromToken, extractUserIdFromToken } from "./token-refresh";
import type { TokenExchangeResult } from "./providers";

/** Builds the OpenAI authorize URL exactly like the Codex CLI (simplified flow). */
export function buildOpenAiAuthorizeUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: OPENAI_OAUTH_CLIENT_ID,
    redirect_uri: OPENAI_REDIRECT_URI,
    scope: OPENAI_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    ...OPENAI_EXTRA_AUTH_PARAMS,
    state,
  });
  return `${OPENAI_AUTH_URL}?${params.toString()}`;
}

export function startOpenAiPkceFlow(): {
  authUrl: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
} {
  const { codeVerifier, codeChallenge, state } = generatePKCE(96);
  return {
    authUrl: buildOpenAiAuthorizeUrl(state, codeChallenge),
    state,
    codeVerifier,
    redirectUri: OPENAI_REDIRECT_URI,
  };
}

function decodeJwtPayload(jwt?: string | null): Record<string, unknown> | null {
  if (!jwt) return null;
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** ChatGPT account binding lives in the `https://api.openai.com/auth` claim of the id_token. */
export function extractChatGptAccountInfo(idToken?: string | null): {
  email: string | null;
  chatgptAccountId: string | null;
  chatgptPlanType: string | null;
} {
  const payload = decodeJwtPayload(idToken);
  if (!payload) return { email: null, chatgptAccountId: null, chatgptPlanType: null };
  const auth = (payload["https://api.openai.com/auth"] ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    email: str(payload.email),
    chatgptAccountId: str(auth.chatgpt_account_id) ?? str(payload.account_id),
    chatgptPlanType: str(auth.chatgpt_plan_type) ?? str(payload.plan_type),
  };
}

export function mapOpenAiTokens(json: Record<string, unknown>): TokenExchangeResult {
  const accessToken = String(json.access_token);
  const idToken = typeof json.id_token === "string" ? json.id_token : undefined;
  const info = extractChatGptAccountInfo(idToken);
  return {
    accessToken,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    idToken,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : undefined,
    scope: typeof json.scope === "string" ? json.scope : undefined,
    email: info.email || extractEmailFromToken(accessToken),
    upstreamUserId: extractUserIdFromToken(idToken) || extractUserIdFromToken(accessToken),
    providerData: {
      authMethod: "pkce",
      chatgptAccountId: info.chatgptAccountId,
      chatgptPlanType: info.chatgptPlanType,
    },
  };
}

/** Exchange the PKCE authorization code at auth.openai.com. */
export async function exchangeOpenAiCode(
  code: string,
  codeVerifier: string,
  redirectUri: string = OPENAI_REDIRECT_URI
): Promise<TokenExchangeResult> {
  const res = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: OPENAI_OAUTH_CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== "string") {
    const errObj = json.error as Record<string, unknown> | string | undefined;
    const err =
      (typeof errObj === "object" ? errObj?.message : errObj) || json.error_description || `HTTP ${res.status}`;
    throw new Error(`OpenAI token exchange failed: ${String(err)}`);
  }
  return mapOpenAiTokens(json);
}
