/**
 * Claude (Anthropic) OAuth constants
 * Matches the official Claude Code CLI flow (client_id 9d1c250a-e61b-44d9-88ed-5944d1962f5e)
 * and 9router's implementation.
 */

export const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const CLAUDE_AUTH_URL = "https://claude.ai/oauth/authorize";
export const CLAUDE_TOKEN_URL = "https://api.anthropic.com/v1/oauth/token";

export const CLAUDE_LOOPBACK_PORT = 54134;
export const CLAUDE_CALLBACK_PATH = "/callback";
export const CLAUDE_REDIRECT_URI = `http://localhost:${CLAUDE_LOOPBACK_PORT}${CLAUDE_CALLBACK_PATH}`;

export const CLAUDE_SCOPES = [
  "org:create_api_key",
  "user:profile",
  "user:inference",
];

export const CLAUDE_CLI_VERSION = "0.80.0";
export const CLAUDE_API_VERSION = "2023-06-01";

export const CLAUDE_BETAS = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "advanced-tool-use-2025-11-20",
  "effort-2025-11-24",
  "structured-outputs-2025-12-15",
  "fast-mode-2026-02-01",
  "redact-thinking-2026-02-12",
  "token-efficient-tools-2026-03-28",
].join(",");

export const CLAUDE_USER_AGENT = `claude-cli/${CLAUDE_CLI_VERSION} (external, sdk-cli)`;
/** Reset grants are gated by surface: only (external, cli) User-Agent is eligible upstream */
export const CLAUDE_RESET_USER_AGENT = `claude-cli/${CLAUDE_CLI_VERSION} (external, cli)`;

export const CLAUDE_DEFAULT_CUSTOM_HEADERS: Record<string, string> = {
  "anthropic-version": CLAUDE_API_VERSION,
  "anthropic-beta": CLAUDE_BETAS,
  "anthropic-dangerous-direct-browser-access": "true",
  "User-Agent": CLAUDE_USER_AGENT,
  "X-App": "cli",
};

export const CLAUDE_BASE_URL = "https://api.anthropic.com/v1";
export const CLAUDE_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const CLAUDE_MODELS_URL = "https://api.anthropic.com/v1/models";
export const CLAUDE_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const CLAUDE_PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
export const CLAUDE_SETTINGS_URL = "https://api.anthropic.com/v1/settings";
export const CLAUDE_ORG_USAGE_URL = "https://api.anthropic.com/v1/organizations/{org_id}/usage";
export const CLAUDE_RESET_RATE_LIMITS_URL = "https://api.anthropic.com/api/organizations/{org_id}/reset_rate_limits";

export const CLAUDE_DEFAULT_MODELS = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
  { id: "claude-opus-5", name: "Claude Opus 5" },
  { id: "claude-fable-5-1", name: "Claude Fable 5.1" },
  { id: "claude-fable-5", name: "Claude Fable 5" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5-20251001", name: "Claude 4.5 Haiku" },
  { id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet" },
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
  { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
];
