import assert from "node:assert/strict";
import {
  CLAUDE_API_VERSION,
  CLAUDE_AUTH_URL,
  CLAUDE_DEFAULT_CUSTOM_HEADERS,
  CLAUDE_OAUTH_CLIENT_ID,
  CLAUDE_REDIRECT_URI,
  CLAUDE_SCOPES,
  CLAUDE_USER_AGENT,
  CLAUDE_RESET_USER_AGENT,
  CLAUDE_OAUTH_USAGE_URL,
  CLAUDE_PROFILE_URL,
} from "../src/lib/oauth/constants/claude";
import {
  buildClaudeAuthorizeUrl,
  exchangeClaudeCode,
  fetchClaudeProfile,
  startClaudePkceFlow,
} from "../src/lib/oauth/claude-oauth";
import { parseCallbackInput } from "../src/lib/oauth/callback-input";
import {
  fetchClaudeQuota,
  fetchClaudeResetGrants,
  consumeClaudeResetCredit,
  parseClaudeResetGrants,
} from "../src/lib/oauth/quota/claude";
import { isOAuthProviderId, OAUTH_PROVIDERS } from "../src/lib/oauth/providers";
import { fetchProviderQuota, isQuotaSupported } from "../src/lib/oauth/quota";
import { createClaudeParser } from "../src/lib/gateways/adapters/claude";
import { CACHE_KEYS, CACHE_TTL } from "../src/lib/redis/cache-keys";

async function runClaudeTests() {
  console.log("=== 1. Claude Provider Manifest & Authorize URL Test ===");
  assert.strictEqual(isOAuthProviderId("claude"), true, "claude is a registered oauth provider");
  const manifest = OAUTH_PROVIDERS.claude;
  assert.strictEqual(manifest.name, "Claude (Anthropic)");
  assert.strictEqual(manifest.flow, "pkce");
  assert.strictEqual(manifest.iconKey, "claude");
  assert.strictEqual(manifest.logoUrl, "/brand-logos/claude.svg");
  assert.strictEqual(manifest.defaultCustomHeaders["anthropic-version"], CLAUDE_API_VERSION);
  assert.strictEqual(manifest.defaultCustomHeaders["User-Agent"], CLAUDE_USER_AGENT);

  const started = startClaudePkceFlow();
  assert.ok(started.authUrl.startsWith(CLAUDE_AUTH_URL), "Auth URL starts with claude.ai/oauth/authorize");
  assert.ok(started.authUrl.includes(`client_id=${CLAUDE_OAUTH_CLIENT_ID}`), "Client ID matches official Claude Code");
  assert.ok(started.authUrl.includes("code=true"), "Contains code=true for CLI flow");
  assert.ok(started.authUrl.includes("response_type=code"), "Response type is code");
  assert.ok(started.authUrl.includes(`redirect_uri=${encodeURIComponent(CLAUDE_REDIRECT_URI)}`), "Redirect URI is localhost:54134/callback");
  assert.strictEqual(new URL(started.authUrl).searchParams.get("scope"), CLAUDE_SCOPES.join(" "));
  assert.ok(started.codeVerifier.length > 40, "PKCE code verifier generated");
  assert.strictEqual(started.redirectUri, CLAUDE_REDIRECT_URI);

  const customUrl = buildClaudeAuthorizeUrl("claude-state-123", "claude-challenge-456");
  assert.ok(customUrl.includes("state=claude-state-123"));
  assert.ok(customUrl.includes("code_challenge=claude-challenge-456"));
  console.log("✔ Manifest registered, authorize URL contains Claude Code CLI parameters and localhost:54134 redirect");

  console.log("=== 2. Callback Input Parsing for Claude ('code#state') ===");
  const parsedHash = parseCallbackInput("anthropic_code_xyz#anthropic_state_abc");
  assert.strictEqual(parsedHash.code, "anthropic_code_xyz");
  assert.strictEqual(parsedHash.state, "anthropic_state_abc");

  const parsedUrl = parseCallbackInput("http://localhost:54134/callback?code=anthropic_code_999&state=anthropic_state_888");
  assert.strictEqual(parsedUrl.code, "anthropic_code_999");
  assert.strictEqual(parsedUrl.state, "anthropic_state_888");

  const parsedPlain = parseCallbackInput("plain_code_123");
  assert.strictEqual(parsedPlain.code, "plain_code_123");
  assert.strictEqual(parsedPlain.state, null);
  console.log("✔ Callback input parses full redirect URL, 'code#state', and plain code");

  console.log("=== 3. Claude Code Exchange & Profile Fetching (Mocked) ===");
  const originalFetch = globalThis.fetch;
  let tokenRequestBody: Record<string, unknown> | null = null;
  let tokenHeaders: Record<string, string> | null = null;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("/v1/oauth/token")) {
      tokenRequestBody = JSON.parse(String(init?.body || "{}"));
      tokenHeaders = (init?.headers as Record<string, string>) || null;
      return new Response(
        JSON.stringify({
          access_token: "sk-ant-access-mock-token",
          refresh_token: "sk-ant-refresh-mock-token",
          expires_in: 2592000,
          token_type: "bearer",
          scope: "org:create_api_key user:profile user:inference",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/api/oauth/profile")) {
      return new Response(
        JSON.stringify({
          account: {
            uuid: "usr_claude_12345",
            email_address: "developer@devnuby.id",
            full_name: "Devnuby Engineer",
          },
          organization: {
            uuid: "org_anthropic_67890",
            name: "Devnuby Org",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return originalFetch(input, init);
  };

  try {
    const tokens = await exchangeClaudeCode(
      "split_code_123#split_state_456",
      "test_code_verifier",
      CLAUDE_REDIRECT_URI
    );

    assert.ok(tokenRequestBody !== null, "Token exchange POST body sent");
    const sentBody = tokenRequestBody as Record<string, unknown>;
    assert.strictEqual(sentBody.code, "split_code_123", "Code extracted before #");
    assert.strictEqual(sentBody.state, "split_state_456", "State extracted after #");
    assert.strictEqual(sentBody.grant_type, "authorization_code");
    assert.strictEqual(sentBody.client_id, CLAUDE_OAUTH_CLIENT_ID);
    assert.strictEqual(sentBody.code_verifier, "test_code_verifier");

    assert.strictEqual(tokens.accessToken, "sk-ant-access-mock-token");
    assert.strictEqual(tokens.refreshToken, "sk-ant-refresh-mock-token");
    assert.strictEqual(tokens.email, "developer@devnuby.id");
    assert.strictEqual(tokens.displayName, "Devnuby Engineer");
    assert.strictEqual(tokens.upstreamUserId, "usr_claude_12345");
    assert.strictEqual(tokens.providerData?.orgId, "org_anthropic_67890");
    assert.strictEqual(tokens.providerData?.organizationName, "Devnuby Org");

    // Test with explicit state parameter (like from query param ?code=...&state=...)
    tokenRequestBody = null;
    await exchangeClaudeCode(
      "bare_code_789",
      "test_code_verifier",
      CLAUDE_REDIRECT_URI,
      "explicit_state_xyz"
    );
    assert.ok(tokenRequestBody !== null, "Token exchange POST body sent for explicit state");
    const sentBody2 = tokenRequestBody as Record<string, unknown>;
    assert.strictEqual(sentBody2.code, "bare_code_789", "Bare code sent");
    assert.strictEqual(sentBody2.state, "explicit_state_xyz", "Explicit state parameter included");

    // Test that missing state throws an informative error
    await assert.rejects(
      () => exchangeClaudeCode("bare_code_no_state", "test_verifier", CLAUDE_REDIRECT_URI),
      /Claude OAuth requires the state parameter/
    );

    console.log("✔ Token exchange parses JSON body, handles both state parameter and code#state, and resolves Claude profile");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("=== 4. Claude Quota & Cedar Ember Reset Grants Parsing ===");
  const mockUsagePayload = {
    five_hour: {
      utilization: 45,
      resets_at: "2026-11-04T02:00:00Z",
    },
    seven_day: {
      utilization: 70,
      resets_at: "2026-11-10T00:00:00Z",
    },
    seven_day_sonnet: {
      utilization: 30,
      resets_at: "2026-11-10T00:00:00Z",
    },
    limits: [
      {
        kind: "weekly_scoped",
        percent: 60,
        resets_at: "2026-11-10T00:00:00Z",
        scope: { model: { display_name: "Fable" } },
      },
    ],
    cedar_ember: {
      eligible: true,
      next_grant_id: "grant_cedar_001",
      cooldown_until: null,
      weekly_resets_at: "2026-11-10T00:00:00Z",
      grants: [
        {
          id: "grant_cedar_001",
          label: "Free weekly limit reset",
          resets_left: 1,
          resets_total: 1,
          starts_at: "2026-11-03T00:00:00Z",
          ends_at: "2026-11-10T00:00:00Z",
          clears: ["five_hour", "seven_day"],
          paused: false,
          usable_now: true,
          use_requires_limit: true,
        },
      ],
    },
  };

  const parsedGrants = parseClaudeResetGrants(mockUsagePayload.cedar_ember);
  assert.ok(parsedGrants, "Parsed cedar_ember grants successfully");
  assert.strictEqual(parsedGrants.availableCount, 1);
  assert.strictEqual(parsedGrants.nextGrantId, "grant_cedar_001");
  assert.deepStrictEqual(parsedGrants.clears, ["five_hour", "seven_day"]);
  assert.strictEqual(parsedGrants.grants.length, 1);
  assert.strictEqual(parsedGrants.grants[0].resetsLeft, 1);

  // Mock quota fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("/api/oauth/usage")) {
      const headers = init?.headers as Record<string, string>;
      assert.strictEqual(headers["User-Agent"], CLAUDE_RESET_USER_AGENT, "Requires (external, cli) User-Agent for reset grants");
      return new Response(JSON.stringify(mockUsagePayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };

  try {
    const quota = await fetchClaudeQuota("mock-access-token");
    assert.strictEqual(quota.supported, true);
    assert.strictEqual(quota.plan, "Claude Code");
    assert.strictEqual(quota.resetCreditsAvailable, 1);
    assert.strictEqual(quota.exhausted, false);

    assert.ok(quota.quotas["session (5h)"]);
    assert.strictEqual(quota.quotas["session (5h)"].used, 45);
    assert.strictEqual(quota.quotas["session (5h)"].remainingPercentage, 55);

    assert.ok(quota.quotas["weekly (7d)"]);
    assert.strictEqual(quota.quotas["weekly (7d)"].used, 70);
    assert.strictEqual(quota.quotas["weekly (7d)"].remainingPercentage, 30);

    assert.ok(quota.quotas["weekly sonnet (7d)"]);
    assert.strictEqual(quota.quotas["weekly sonnet (7d)"].used, 30);

    assert.ok(quota.quotas["weekly fable (7d)"]);
    assert.strictEqual(quota.quotas["weekly fable (7d)"].used, 60);

    // Verify registry check
    assert.strictEqual(isQuotaSupported("claude"), true);
    const regQuota = await fetchProviderQuota("claude", "mock-access-token", null);
    assert.strictEqual(regQuota.resetCreditsAvailable, 1);

    console.log("✔ Claude quota windows (5h, 7d, Sonnet, Fable) and cedar_ember reset credits parsed accurately");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("=== 5. Claude Limit Reset Consumption Test ===");
  let resetCalledUrl = "";
  let resetRequestBody: Record<string, unknown> | null = null;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("/api/oauth/usage")) {
      return new Response(JSON.stringify(mockUsagePayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/reset_rate_limits")) {
      resetCalledUrl = url;
      resetRequestBody = JSON.parse(String(init?.body || "{}"));
      return new Response(
        JSON.stringify({
          result: "reset",
          resets_left: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return originalFetch(input, init);
  };

  try {
    const resetResult = await consumeClaudeResetCredit(
      "mock-access-token",
      null, // auto-discover grantId from usage
      { orgId: "org_anthropic_67890" }
    );

    assert.strictEqual(resetResult.ok, true);
    assert.strictEqual(resetResult.windowsReset, 1);
    assert.strictEqual(resetResult.code, "reset");
    assert.ok(resetCalledUrl.includes("/api/organizations/org_anthropic_67890/reset_rate_limits"));
    assert.ok(resetRequestBody !== null, "Reset request body sent");
    const sentResetBody = resetRequestBody as Record<string, unknown>;
    assert.strictEqual(sentResetBody.program, "cedar_ember");
    assert.strictEqual(sentResetBody.grant_id, "grant_cedar_001");
    assert.ok(typeof sentResetBody.request_id === "string");
    console.log("✔ Claude reset grant consumed upstream, rate limits refilled successfully");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("=== 6. Claude SSE Stream Parsing (Messages API) ===");
  const parser = createClaudeParser();

  // 1. message_start
  const startEvents = parser({
    event: "message_start",
    data: JSON.stringify({
      type: "message_start",
      message: {
        id: "msg_123",
        type: "message",
        role: "assistant",
        usage: { input_tokens: 150 },
      },
    }),
  });
  assert.strictEqual(startEvents.length, 1);
  assert.strictEqual(startEvents[0].type, "usage");
  if (startEvents[0].type === "usage") {
    assert.strictEqual(startEvents[0].promptTokens, 150);
  }

  // 2. content_block_delta (thinking)
  const thinkingEvents = parser({
    event: "content_block_delta",
    data: JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "Thinking through the solution..." },
    }),
  });
  assert.strictEqual(thinkingEvents.length, 1);
  assert.strictEqual(thinkingEvents[0].type, "reasoning");
  if (thinkingEvents[0].type === "reasoning") {
    assert.strictEqual(thinkingEvents[0].text, "Thinking through the solution...");
  }

  // 3. content_block_delta (text)
  const textEvents = parser({
    event: "content_block_delta",
    data: JSON.stringify({
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "Hello from Claude!" },
    }),
  });
  assert.strictEqual(textEvents.length, 1);
  assert.strictEqual(textEvents[0].type, "delta");
  if (textEvents[0].type === "delta") {
    assert.strictEqual(textEvents[0].text, "Hello from Claude!");
  }

  // 4. content_block_start (tool_use)
  const toolStartEvents = parser({
    event: "content_block_start",
    data: JSON.stringify({
      type: "content_block_start",
      index: 2,
      content_block: { type: "tool_use", id: "toolu_01ABC", name: "search" },
    }),
  });
  assert.strictEqual(toolStartEvents.length, 1);
  assert.strictEqual(toolStartEvents[0].type, "tool_call");

  // 5. content_block_delta (input_json_delta)
  const toolDeltaEvents = parser({
    event: "content_block_delta",
    data: JSON.stringify({
      type: "content_block_delta",
      index: 2,
      delta: { type: "input_json_delta", partial_json: '{"q": "devnuby"}' },
    }),
  });
  assert.strictEqual(toolDeltaEvents.length, 1);
  assert.strictEqual(toolDeltaEvents[0].type, "tool_call");
  if (toolDeltaEvents[0].type === "tool_call") {
    assert.strictEqual(toolDeltaEvents[0].argumentsDelta, '{"q": "devnuby"}');
  }

  // 6. message_delta (finish + usage)
  const finishEvents = parser({
    event: "message_delta",
    data: JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 85 },
    }),
  });
  assert.strictEqual(finishEvents.length, 2);
  assert.strictEqual(finishEvents[0].type, "usage");
  assert.strictEqual(finishEvents[1].type, "finish");
  if (finishEvents[1].type === "finish") {
    assert.strictEqual(finishEvents[1].reason, "stop");
  }
  console.log("✔ Anthropic Messages SSE parser translates thinking, text, tool calls, finish, and usage events seamlessly");

  console.log("=== 7. Cache Keys & TTL Verification ===");
  const cKey = CACHE_KEYS.providerResetCredits("claude", 123n);
  assert.strictEqual(cKey, "cache:admin:provider_connection:claude:123:reset_credits");
  const cHistKey = CACHE_KEYS.providerResetCreditsHistory("claude", 123n);
  assert.strictEqual(cHistKey, "cache:admin:provider_connection:claude:123:reset_credits_history");
  assert.strictEqual(CACHE_TTL.OPENAI_RESET_CREDITS, 300);
  console.log("✔ Redis cache keys and 5-minute TTL configured for Claude limit resets");

  console.log("\nALL CLAUDE OAUTH TESTS PASSED 100%! 🚀\n");
}

runClaudeTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
