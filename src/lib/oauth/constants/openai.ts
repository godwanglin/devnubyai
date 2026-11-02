/**
 * OpenAI / ChatGPT (Codex) OAuth constants
 * Matches the official OpenAI Codex CLI flow (client_id app_EMoamEEZ73f0CkXaXp7hrann)
 * and 9router's implementation.
 */

export const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_AUTH_URL = "https://auth.openai.com/oauth/authorize";
export const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";

export const OPENAI_LOOPBACK_PORT = 1455;
export const OPENAI_CALLBACK_PATH = "/auth/callback";
export const OPENAI_REDIRECT_URI = `http://localhost:${OPENAI_LOOPBACK_PORT}${OPENAI_CALLBACK_PATH}`;

export const OPENAI_SCOPE = "openid profile email offline_access";

export const OPENAI_EXTRA_AUTH_PARAMS: Record<string, string> = {
  id_token_add_organizations: "true",
  codex_cli_simplified_flow: "true",
  originator: "codex_cli_rs",
};

export const CODEX_CLI_VERSION = "0.159.0";

export const OPENAI_DEFAULT_CUSTOM_HEADERS: Record<string, string> = {
  originator: "codex_cli_rs",
  "User-Agent": `codex_cli_rs/${CODEX_CLI_VERSION}`,
  version: CODEX_CLI_VERSION,
};

export const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const CODEX_RESET_CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
export const CODEX_RESET_CREDITS_HISTORY_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/history";
export const CODEX_RESET_CREDITS_CONSUME_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume";

/** Neutral default instructions injected into Codex responses if request has none */
export const CODEX_DEFAULT_INSTRUCTIONS = "You are a helpful assistant.";
