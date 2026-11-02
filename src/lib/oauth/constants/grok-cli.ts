/**
 * Grok CLI / Grok Build constants — ported from 9router wire baseline.
 * Source of truth: wire capture of official @xai-official/grok 1.0.44
 */
export const GROK_CLI_VERSION = "1.0.44";
export const GROK_CLI_MODEL = "grok-build";
export const GROK_CLI_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
export const GROK_CLI_CLIENT_IDENTIFIER = "grok-shell";
export const GROK_CLI_USER_AGENT = `grok-shell/${GROK_CLI_VERSION} (linux; x86_64)`;
export const GROK_CLI_PAGER_USER_AGENT = `grok-pager/${GROK_CLI_VERSION} grok-shell/${GROK_CLI_VERSION} (linux; x86_64)`;

export const GROK_CLI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const GROK_CLI_DEVICE_CODE_URL = "https://auth.x.ai/oauth2/device/code";
export const GROK_CLI_TOKEN_URL = "https://auth.x.ai/oauth2/token";
export const GROK_CLI_SCOPE =
  "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write";
export const GROK_CLI_REFERRER = "grok-build";

/**
 * Default custom headers exactly as shown in screenshot (User-Agent, x-grok-client-identifier, x-grok-client-version).
 */
export const GROK_CLI_DEFAULT_CUSTOM_HEADERS: Record<string, string> = {
  "User-Agent": GROK_CLI_USER_AGENT,
  "x-grok-client-identifier": GROK_CLI_CLIENT_IDENTIFIER,
  "x-grok-client-version": GROK_CLI_VERSION,
};
