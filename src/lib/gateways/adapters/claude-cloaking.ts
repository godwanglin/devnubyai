import crypto from "node:crypto";
import { CLAUDE_CLI_VERSION, CLAUDE_DEFAULT_CUSTOM_HEADERS } from "@/lib/oauth/constants/claude";

/**
 * Extracts CLI version from User-Agent string (e.g. "claude-cli/2.1.280 (external, cli)" -> "2.1.280").
 * Falls back to canonical CLAUDE_CLI_VERSION.
 */
export function extractClaudeCliVersion(userAgent?: string | null): string {
  if (!userAgent) return CLAUDE_CLI_VERSION;
  const match = userAgent.match(/claude-cli\/([0-9.]+)/i);
  return match ? match[1] : CLAUDE_CLI_VERSION;
}

/**
 * Generates a deterministic RFC4122 v4 UUID from an arbitrary seed string.
 */
export function deriveClaudeUuid(seed: string): string {
  const h = crypto.createHash("sha256").update(seed).digest("hex");
  return (
    h.slice(0, 8) +
    "-" +
    h.slice(8, 12) +
    "-4" +
    h.slice(13, 16) +
    "-" +
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) +
    h.slice(17, 20) +
    "-" +
    h.slice(20, 32)
  );
}

/**
 * Generates official-format Claude Code user_id metadata JSON for client fingerprinting.
 */
export function generateFakeClaudeUserId(sessionId: string, apiKey: string): string {
  const deviceId = crypto.createHash("sha256").update(`device:${apiKey}`).digest("hex");
  const accountUuid = deriveClaudeUuid(`account:${apiKey}`);
  return JSON.stringify({ device_id: deviceId, account_uuid: accountUuid, session_id: sessionId });
}

/**
 * Generates the x-anthropic-billing-header system instruction expected by Anthropic for Claude Code tokens.
 */
export function generateClaudeBillingHeader(payload: unknown, version = CLAUDE_CLI_VERSION): string {
  const content = JSON.stringify(payload);
  const cch = crypto.createHash("sha256").update(content).digest("hex").slice(0, 5);
  const buildHash = crypto.randomBytes(2).toString("hex").slice(0, 3);
  return `x-anthropic-billing-header: cc_version=${version}.${buildHash}; cc_entrypoint=sdk-cli; cch=${cch};`;
}

/**
 * Applies Claude Code cloaking to request body when authenticated with a Claude Code OAuth token (`sk-ant-oat...`).
 * Injects:
 * 1. `x-anthropic-billing-header` into system prompt
 * 2. `metadata.user_id` device/account fingerprint
 * Strips OpenAI-specific keys that Anthropic rejects.
 */
export function applyClaudeCodeCloaking(
  body: Record<string, unknown>,
  apiKey: string,
  sessionId: string,
  version = CLAUDE_CLI_VERSION
): Record<string, unknown> {
  if (!apiKey || !apiKey.includes("sk-ant-oat")) return body;

  const result = { ...body };
  const billingText = generateClaudeBillingHeader(body, version);
  const billingBlock = { type: "text", text: billingText };

  if (Array.isArray(result.system)) {
    const first = result.system[0] as { text?: string } | undefined;
    if (!first?.text?.startsWith("x-anthropic-billing-header:")) {
      result.system = [billingBlock, ...result.system];
    }
  } else if (typeof result.system === "string") {
    result.system = [billingBlock, { type: "text", text: result.system }];
  } else {
    result.system = [billingBlock];
  }

  const existingMeta = (result.metadata as Record<string, unknown> | undefined) || {};
  if (!existingMeta.user_id) {
    result.metadata = {
      ...existingMeta,
      user_id: generateFakeClaudeUserId(sessionId, apiKey),
    };
  }

  // Strip non-standard Anthropic fields
  delete result.effort;
  delete result.reasoning_effort;
  delete result.reasoning;

  return result;
}

/**
 * Builds standard Claude headers with dashboard custom header overrides and session-id.
 */
export function buildClaudeHeaders(
  apiKey: string,
  sessionId: string,
  customHeaders?: Record<string, string> | null
): Record<string, string> {
  const headers: Record<string, string> = {
    ...CLAUDE_DEFAULT_CUSTOM_HEADERS,
    ...(customHeaders ?? {}),
    Authorization: `Bearer ${apiKey}`,
    "x-claude-code-session-id": sessionId,
  };
  return headers;
}
