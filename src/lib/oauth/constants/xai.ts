/**
 * xAI (Grok) OAuth constants — ported from 9router / wire baseline.
 */
export const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const XAI_ISSUER = "https://auth.x.ai";
export const XAI_AUTH_URL = "https://auth.x.ai/oauth2/authorize";
export const XAI_TOKEN_URL = "https://auth.x.ai/oauth2/token";
export const XAI_DISCOVERY_URL = "https://auth.x.ai/.well-known/openid-configuration";
export const XAI_API_BASE = "https://api.x.ai/v1";

// Loopback callback for PKCE (matches official xAI client_id allowed redirect)
export const XAI_LOOPBACK_PORT = 56121;
export const XAI_CALLBACK_PATH = "/callback";
export const XAI_REDIRECT_URI = `http://127.0.0.1:${XAI_LOOPBACK_PORT}${XAI_CALLBACK_PATH}`;

export const XAI_SCOPE = "openid profile email offline_access grok-cli:access api:access";
export const XAI_USER_AGENT = "grok-cli/9router";

export const XAI_DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": XAI_USER_AGENT,
  Accept: "application/json",
};
