import crypto from "node:crypto";
import {
  XAI_AUTH_URL,
  XAI_CLIENT_ID,
  XAI_DEFAULT_HEADERS,
  XAI_REDIRECT_URI,
  XAI_SCOPE,
  XAI_TOKEN_URL,
} from "./constants/xai";
import {
  GROK_CLI_CLIENT_ID,
  GROK_CLI_DEFAULT_CUSTOM_HEADERS,
  GROK_CLI_DEVICE_CODE_URL,
  GROK_CLI_PAGER_USER_AGENT,
  GROK_CLI_REFERRER,
  GROK_CLI_SCOPE,
  GROK_CLI_TOKEN_URL,
  GROK_CLI_VERSION,
} from "./constants/grok-cli";
import { CODEX_BASE_URL, OPENAI_DEFAULT_CUSTOM_HEADERS } from "./constants/openai";
import { ANTIGRAVITY_STREAM_URL, ANTIGRAVITY_USER_AGENT } from "./constants/antigravity";
import { generatePKCE } from "./pkce";
import { extractEmailFromToken, extractUserIdFromToken } from "./token-refresh";

export type OAuthProviderId = "xai" | "grok-cli" | "openai" | "antigravity";

export interface OAuthProviderManifest {
  id: OAuthProviderId;
  name: string;
  description: string;
  flow: "pkce" | "device_code";
  iconKey: OAuthProviderId;
  logoUrl?: string;
  defaultBaseUrl: string;
  wireApi: "chat" | "responses";
  defaultModelsPath: string;
  defaultCustomHeaders: Record<string, string>;
}

export const OAUTH_PROVIDERS: Record<OAuthProviderId, OAuthProviderManifest> = {
  xai: {
    id: "xai",
    name: "xAI (Grok)",
    description: "Connect your xAI account via PKCE browser authorization (api.x.ai).",
    flow: "pkce",
    iconKey: "xai",
    logoUrl: "/brand-logos/grok.svg",
    defaultBaseUrl: "https://api.x.ai/v1",
    wireApi: "chat",
    defaultModelsPath: "/models",
    defaultCustomHeaders: XAI_DEFAULT_HEADERS,
  },
  "grok-cli": {
    id: "grok-cli",
    name: "Grok CLI (Grok Build)",
    description: "Sign in with your xAI / Grok account via Device Code (cli-chat-proxy.grok.com).",
    flow: "device_code",
    iconKey: "grok-cli",
    logoUrl: "/brand-logos/grok.svg",
    defaultBaseUrl: "https://cli-chat-proxy.grok.com/v1",
    wireApi: "responses",
    defaultModelsPath: "/models",
    defaultCustomHeaders: GROK_CLI_DEFAULT_CUSTOM_HEADERS,
  },
  openai: {
    id: "openai",
    name: "OpenAI (ChatGPT)",
    description: "Sign in with your ChatGPT account via PKCE (Codex backend, chatgpt.com).",
    flow: "pkce",
    iconKey: "openai",
    logoUrl: "/brand-logos/openai.svg",
    defaultBaseUrl: CODEX_BASE_URL,
    wireApi: "responses",
    defaultModelsPath: "/models",
    defaultCustomHeaders: OPENAI_DEFAULT_CUSTOM_HEADERS,
  },
  antigravity: {
    id: "antigravity",
    name: "Antigravity (Google Cloud Code)",
    description: "Sign in with your Google account via PKCE (Cloud Code Assist backend: Gemini & Claude).",
    flow: "pkce",
    iconKey: "antigravity",
    logoUrl: "/brand-logos/gemini.svg",
    defaultBaseUrl: new URL(ANTIGRAVITY_STREAM_URL).origin,
    // Not used for inference: the dispatcher routes antigravity to its own Gemini adapter
    wireApi: "chat",
    defaultModelsPath: "/v1internal:fetchAvailableModels",
    defaultCustomHeaders: { "User-Agent": ANTIGRAVITY_USER_AGENT },
  },
};

export function isOAuthProviderId(id: string): id is OAuthProviderId {
  return id === "xai" || id === "grok-cli" || id === "openai" || id === "antigravity";
}

/** Builds the authorize URL shown in the xAI PKCE popup */
export function buildXaiAuthorizeUrl(state: string, codeChallenge: string): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: XAI_CLIENT_ID,
    redirect_uri: XAI_REDIRECT_URI,
    scope: XAI_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
    plan: "generic",
    referrer: "cli-proxy-api",
  });
  return `${XAI_AUTH_URL}?${params.toString()}`;
}

export function startXaiPkceFlow(): {
  authUrl: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
} {
  const { codeVerifier, codeChallenge, state } = generatePKCE(96);
  const authUrl = buildXaiAuthorizeUrl(state, codeChallenge);
  return { authUrl, state, codeVerifier, redirectUri: XAI_REDIRECT_URI };
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
}

/** Requests a device code for Grok CLI */
export async function requestGrokCliDeviceCode(): Promise<DeviceCodeResponse> {
  const body = new URLSearchParams({
    client_id: GROK_CLI_CLIENT_ID,
    scope: GROK_CLI_SCOPE,
    referrer: GROK_CLI_REFERRER,
  });

  const res = await fetch(GROK_CLI_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": GROK_CLI_PAGER_USER_AGENT,
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Device code request failed (${res.status}): ${errText}`);
  }

  return (await res.json()) as DeviceCodeResponse;
}

export interface TokenExchangeResult {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn?: number;
  scope?: string;
  email?: string | null;
  displayName?: string | null;
  upstreamUserId?: string | null;
  providerData?: Record<string, unknown>;
}

/** Exchange PKCE code for tokens (xAI) */
export async function exchangeXaiCode(
  code: string,
  codeVerifier: string,
  redirectUri: string = XAI_REDIRECT_URI
): Promise<TokenExchangeResult> {
  const res = await fetch(XAI_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: XAI_CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== "string") {
    const err = String(json.error_description || json.error || `HTTP ${res.status}`);
    throw new Error(`xAI token exchange failed: ${err}`);
  }

  const accessToken = String(json.access_token);
  const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : undefined;
  const idToken = typeof json.id_token === "string" ? json.id_token : undefined;
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : undefined;
  const scope = typeof json.scope === "string" ? json.scope : undefined;

  const email = extractEmailFromToken(idToken) || extractEmailFromToken(accessToken);
  const upstreamUserId = extractUserIdFromToken(idToken) || extractUserIdFromToken(accessToken);

  return {
    accessToken,
    refreshToken,
    idToken,
    expiresIn,
    scope,
    email,
    upstreamUserId,
    providerData: { authMethod: "pkce", idToken: idToken ?? null },
  };
}

export type DeviceTokenPollResult =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "success"; tokens: TokenExchangeResult }
  | { status: "error"; error: string };

/** Poll token endpoint for Device Code (Grok CLI) */
export async function pollGrokCliToken(deviceCode: string): Promise<DeviceTokenPollResult> {
  const res = await fetch(GROK_CLI_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": GROK_CLI_PAGER_USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: GROK_CLI_CLIENT_ID,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (res.ok && typeof json.access_token === "string") {
    const accessToken = String(json.access_token);
    const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : undefined;
    const idToken = typeof json.id_token === "string" ? json.id_token : undefined;
    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : undefined;
    const scope = typeof json.scope === "string" ? json.scope : undefined;

    // Optional: fetch user profile from cli-chat-proxy for extra display info
    let profileEmail: string | null = null;
    let profileUserId: string | null = null;
    let profileDisplayName: string | null = null;
    let profileData: Record<string, unknown> = {};

    try {
      const userRes = await fetch("https://cli-chat-proxy.grok.com/v1/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "User-Agent": GROK_CLI_PAGER_USER_AGENT,
          "x-xai-token-auth": "xai-grok-cli",
          "x-grok-client-version": GROK_CLI_VERSION,
        },
      });
      if (userRes.ok) {
        const u = (await userRes.json()) as Record<string, unknown>;
        profileEmail = typeof u.email === "string" ? u.email : null;
        profileUserId = typeof u.userId === "string" ? u.userId : typeof u.principalId === "string" ? u.principalId : null;
        const names = [u.firstName, u.lastName].filter((n) => typeof n === "string" && n).join(" ").trim();
        profileDisplayName = names || null;
        profileData = u;
      }
    } catch {
      // Non-fatal
    }

    const email = extractEmailFromToken(idToken) || extractEmailFromToken(accessToken) || profileEmail;
    const upstreamUserId = extractUserIdFromToken(idToken) || extractUserIdFromToken(accessToken) || profileUserId;

    return {
      status: "success",
      tokens: {
        accessToken,
        refreshToken,
        idToken,
        expiresIn,
        scope,
        email,
        displayName: profileDisplayName,
        upstreamUserId,
        providerData: {
          authMethod: "device_code",
          idToken: idToken ?? null,
          hasGrokCodeAccess: profileData.hasGrokCodeAccess ?? null,
          subscriptionTier: profileData.subscriptionTier ?? null,
        },
      },
    };
  }

  const errCode = String(json.error ?? "");
  if (errCode === "authorization_pending") return { status: "pending" };
  if (errCode === "slow_down") return { status: "slow_down" };

  const desc = String(json.error_description || json.message || errCode || `HTTP ${res.status}`);
  return { status: "error", error: desc };
}
