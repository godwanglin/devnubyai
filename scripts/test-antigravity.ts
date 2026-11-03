import assert from "node:assert/strict";
import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_REDIRECT_URI,
  DEFAULT_THINKING_AG_SIGNATURE,
  buildIdeRequestId,
  toNumericSessionId,
} from "../src/lib/oauth/constants/antigravity";
import { buildAntigravityAuthorizeUrl } from "../src/lib/oauth/antigravity-oauth";
import {
  buildAntigravityEnvelope,
  createAntigravityParser,
  isGemini4Model,
} from "../src/lib/gateways/adapters/antigravity";
import {
  cleanJSONSchemaForAntigravity,
  sanitizeGeminiFunctionName,
} from "../src/lib/gateways/adapters/antigravity-schema";
import {
  antigravityQuotaFamily,
  isOtherAntigravityFamily,
  parseAntigravityQuotaSummary,
} from "../src/lib/oauth/quota/antigravity";
import { isConnectionQuotaExhausted, type PoolConnection } from "../src/lib/gateways/oauth-dispatch";
import { isOAuthProviderId, OAUTH_PROVIDERS } from "../src/lib/oauth/providers";
import type { GatewayExecutionRequest } from "../src/lib/gateways/types";
import type { ToolDefinition } from "../src/lib/tools/types";
import { antigravityThinkingConfig, resolveAntigravityModel } from "../src/lib/gateways/adapters/antigravity-model-map";
import { isAntigravityPlaceholderModel, pingAntigravityModel } from "../src/lib/gateways/antigravity-models";

function testAuthorizeUrl() {
  const url = buildAntigravityAuthorizeUrl("state-123", "challenge-456");
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://accounts.google.com");
  assert.equal(parsed.pathname, "/o/oauth2/v2/auth");
  assert.equal(parsed.searchParams.get("client_id"), ANTIGRAVITY_CLIENT_ID);
  assert.equal(parsed.searchParams.get("redirect_uri"), ANTIGRAVITY_REDIRECT_URI);
  assert.equal(parsed.searchParams.get("access_type"), "offline");
  assert.equal(parsed.searchParams.get("prompt"), "consent");
  assert.equal(parsed.searchParams.get("code_challenge"), "challenge-456");
  assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
  assert.equal(parsed.searchParams.get("state"), "state-123");
  assert(parsed.searchParams.get("scope")?.includes("cloud-platform"));
  console.log("✓ Google Antigravity Authorize URL matches Cloud Code specifications");
}

function testSessionIdAndRequestId() {
  const numId = toNumericSessionId("user-123:session-abc");
  assert(/^-\d+$/.test(numId), `Expected negative bigint string, got: ${numId}`);

  const reqId = buildIdeRequestId(3);
  assert(/^agent\/[^/]+\/\d+\/[^/]+\/\d+$/.test(reqId), `Unexpected requestId: ${reqId}`);
  assert(reqId.endsWith("/3"));
  console.log("✓ Numeric sessionId and agent requestId format verified");
}

function testSchemaSanitizer() {
  const dirty = {
    type: "object",
    title: "Bad Title",
    description: "Sample tool",
    $schema: "http://json-schema.org/draft-07/schema#",
    minLength: 1,
    properties: {
      url: {
        type: "string",
        format: "uri",
        minLength: 5,
        default: "https://example.com",
        description: "Target URL",
      },
      count: {
        type: ["integer", "null"],
        minimum: 1,
        maximum: 100,
      },
      mode: {
        anyOf: [
          { type: "string", enum: ["fast", "slow"] },
          { type: "null" },
        ],
      },
      emptyObj: {},
    },
    required: ["url", "nonExistentField"],
  };

  const cleaned = cleanJSONSchemaForAntigravity(dirty) as Record<string, unknown>;
  assert.equal(cleaned.type, "object");
  assert.equal(cleaned.title, undefined);
  assert.equal(cleaned.$schema, undefined);
  assert.equal(cleaned.minLength, undefined);

  const props = cleaned.properties as Record<string, Record<string, unknown>>;
  assert.equal(props.url.type, "string");
  assert.equal(props.url.format, undefined);
  assert.equal(props.url.minLength, undefined);
  assert.equal(props.url.default, undefined);

  assert.equal(props.count.type, "integer");

  assert.equal(props.mode.type, "string");
  assert.deepEqual(props.mode.enum, ["fast", "slow"]);

  // A nested "any value" schema becomes a plain string, not an object with a forced field
  assert.equal(props.emptyObj.type, "string");

  // nonExistentField must be dropped from required
  assert.deepEqual(cleaned.required, ["url"]);

  // Property NAMES that collide with schema keywords must survive
  const named = cleanJSONSchemaForAntigravity({
    type: "object",
    properties: { title: { type: "string" }, format: { type: "string", enum: ["docx", "pdf"] }, default: { type: "boolean" } },
    required: ["title", "format"],
  }) as { properties: Record<string, Record<string, unknown>>; required: string[] };
  assert.deepEqual(Object.keys(named.properties), ["title", "format", "default"]);
  assert.deepEqual(named.properties.format.enum, ["docx", "pdf"]);
  assert.deepEqual(named.required, ["title", "format"]);

  // Empty top-level parameters get the reason placeholder
  const empty = cleanJSONSchemaForAntigravity({ type: "object", properties: {} }) as { required: string[] };
  assert.deepEqual(empty.required, ["reason"]);

  assert.equal(sanitizeGeminiFunctionName("123-bad-tool!name"), "_123-bad-tool_name");
  console.log("✓ Antigravity JSON Schema cleaner strips unsupported keywords and injects placeholders");
}

function testEnvelopeBuilder() {
  const dummyTool: ToolDefinition = {
    name: "status_check",
    description: "Check status",
    parameters: {
      type: "object",
      properties: { service: { type: "string", description: "Service name" } },
      required: ["service"],
    },
    execute: async () => ({ success: true, data: { ok: true } }),
  };

  const request: GatewayExecutionRequest = {
    model: "claude-sonnet-5-5-high",
    messages: [
      { role: "system", content: "You are a senior engineer." },
      { role: "user", content: "Check status." },
      {
        role: "assistant",
        content: "Running tool...",
        toolCalls: [{ id: "call_1", name: "status_check", arguments: '{"service":"db"}' }],
      },
      { role: "tool", toolCallId: "call_1", content: '{"ok":true}' },
    ],
    tools: [dummyTool],
    maxTokens: 4096,
    temperature: 0.7,
  };

  const envelope = buildAntigravityEnvelope(request, "project-123", "test-seed") as {
    project: string;
    model: string;
    userAgent: string;
    requestId: string;
    requestType?: unknown;
    request: {
      sessionId: string;
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
      systemInstruction?: { role: string; parts: Array<{ text: string }> };
      generationConfig: Record<string, unknown>;
      tools?: Array<{ functionDeclarations: Array<{ name: string }> }>;
    };
  };

  assert.equal(envelope.project, "project-123");
  assert.equal(envelope.model, "claude-sonnet-5-5-high");
  assert.equal(envelope.userAgent, "antigravity");
  assert.equal(envelope.requestType, undefined, "requestType MUST be omitted for chat");
  assert(/^agent\/[^/]+\/\d+\/[^/]+\/\d+$/.test(envelope.requestId));
  assert(/^-\d+$/.test(envelope.request.sessionId));

  assert.equal(envelope.request.systemInstruction?.parts[0].text, "You are a senior engineer.");
  // claude-sonnet-5-5-high carries level: high (budget: 24576), so output floor is 32768
  assert.equal(envelope.request.generationConfig.maxOutputTokens, 32768);
  assert.equal(envelope.request.generationConfig.temperature, 0.7);

  // Contents check
  const contents = envelope.request.contents;
  assert(contents.length >= 2);
  const assistantTurn = contents.find((c) => c.role === "model");
  assert(assistantTurn);
  const callPart = assistantTurn.parts.find((p) => p.functionCall);
  assert(callPart);
  assert.equal(callPart.thoughtSignature, DEFAULT_THINKING_AG_SIGNATURE);

  // Tools check
  assert(envelope.request.tools);
  assert.equal(envelope.request.tools[0].functionDeclarations[0].name, "status_check");

  // Gemini 4 model check (must omit temperature/topP)
  const gemini4Request: GatewayExecutionRequest = {
    model: "gemini-4-argon-high",
    messages: [{ role: "user", content: "Hi" }],
    temperature: 0.5,
  };
  assert(isGemini4Model("gemini-4-argon-high"));
  const g4Envelope = buildAntigravityEnvelope(gemini4Request, "p-4") as {
    model: string;
    request: { generationConfig: { temperature?: number; thinkingConfig?: { thinkingBudget?: number } } };
  };
  assert.equal(g4Envelope.request.generationConfig.temperature, undefined);
  assert.equal(g4Envelope.model, "gemini-4-argon-high");
  assert.equal(g4Envelope.request.generationConfig.thinkingConfig?.thinkingBudget, 24576);

  console.log("✓ Antigravity envelope correctly formats Gemini contents, thoughtSignature, and tools");
}

function testParser() {
  const parse = createAntigravityParser();

  // Chunk 1: reasoning
  const events1 = parse({
    event: "message",
    data: JSON.stringify({
      response: {
        candidates: [{ content: { parts: [{ text: "Thinking deeply...", thought: true }] } }],
      },
    }),
  });
  assert.equal(events1.length, 1);
  assert.equal(events1[0].type, "reasoning");
  assert.equal(events1[0].text, "Thinking deeply...");

  // Chunk 2: text delta + tool_call
  const events2 = parse({
    event: "message",
    data: JSON.stringify({
      response: {
        candidates: [
          {
            content: {
              parts: [
                { text: "Here is the plan: " },
                { functionCall: { id: "call_abc", name: "search", args: { query: "Devnuby" } } },
              ],
            },
          },
        ],
      },
    }),
  });
  assert.equal(events2.length, 2);
  assert.equal(events2[0].type, "delta");
  assert.equal(events2[0].text, "Here is the plan: ");
  assert.equal(events2[1].type, "tool_call");
  assert.equal(events2[1].callId, "call_abc");
  assert.equal(events2[1].index, 0);

  // Chunk 3: finish with usage
  const events3 = parse({
    event: "message",
    data: JSON.stringify({
      response: {
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: {
          promptTokenCount: 120,
          candidatesTokenCount: 45,
          thoughtsTokenCount: 15,
          totalTokenCount: 180,
        },
      },
    }),
  });
  assert.equal(events3.length, 2);
  assert.equal(events3[0].type, "usage");
  assert.equal(events3[0].promptTokens, 120);
  assert.equal(events3[0].completionTokens, 60); // 45 + 15
  assert.equal(events3[1].type, "finish");
  assert.equal(events3[1].reason, "tool_calls"); // saw a tool call earlier -> finishReason upgraded

  console.log("✓ Antigravity SSE parser decodes reasoning, deltas, function calls, and usage");
}

function testQuotaSplit() {
  assert.equal(antigravityQuotaFamily("claude-sonnet-5-5-high"), "claude_gpt_");
  assert.equal(antigravityQuotaFamily("gemini-4-argon-high"), "gemini_");
  assert(isOtherAntigravityFamily("gemini_weekly", "claude-sonnet-5-5-high"));
  assert(!isOtherAntigravityFamily("claude_gpt_weekly", "claude-sonnet-5-5-high"));

  const rawSummary = {
    groups: [
      {
        displayName: "Gemini",
        buckets: [
          { window: "5h", remainingFraction: 0.0, resetTime: "2026-11-03T20:00:00Z" },
          { window: "weekly", remainingFraction: 0.0, resetTime: "2026-11-05T00:00:00Z" },
        ],
      },
      {
        displayName: "Claude & GPT",
        buckets: [
          { window: "5h", remainingFraction: 0.85, resetTime: "2026-11-03T22:00:00Z" },
          { window: "weekly", remainingFraction: 0.9, resetTime: "2026-11-08T00:00:00Z" },
        ],
      },
    ],
  };

  const parsed = parseAntigravityQuotaSummary(rawSummary);
  assert(parsed.gemini_session && parsed.gemini_session.remainingPercentage === 0);
  assert(parsed.claude_gpt_session && parsed.claude_gpt_session.remainingPercentage === 85);

  const mockConn: PoolConnection = {
    id: 1n,
    email: "test@example.com",
    upstreamUserId: "sub_123",
    expiresAt: null,
    hasRefreshToken: true,
    quotaCached: {
      supported: true,
      exhausted: false,
      quotas: parsed,
    },
    providerData: {},
  };

  // Calling Gemini model with 0% Gemini quota -> should report exhausted
  assert(isConnectionQuotaExhausted(mockConn, Date.now(), "gemini-4-argon-high"));

  // Calling Claude model with 85% Claude quota -> should NOT report exhausted!
  assert(!isConnectionQuotaExhausted(mockConn, Date.now(), "claude-sonnet-5-5-high"));

  console.log("✓ Multi-family Antigravity quota isolation (Gemini vs Claude/GPT) verified");
}

function testModelResolution() {
  assert.deepEqual(resolveAntigravityModel("gemini-3.1-pro-high"), { upstreamModel: "gemini-pro-agent", level: null });
  assert.deepEqual(resolveAntigravityModel("gemini-3.7-flash-high"), { upstreamModel: "gemini-3.7-flash-tiered", level: "high" });
  assert.deepEqual(resolveAntigravityModel("claude-sonnet-5-5"), { upstreamModel: "claude-sonnet-5-5-high", level: "high" });
  assert.deepEqual(resolveAntigravityModel("claude-opus-5-5-low"), { upstreamModel: "claude-opus-5-5-low", level: "low" });
  assert.deepEqual(resolveAntigravityModel("claude-sonnet-4-6"), { upstreamModel: "claude-sonnet-4-6", level: null });
  assert.deepEqual(resolveAntigravityModel("gemini-3.8-flash-medium(high)"), { upstreamModel: "gemini-3.8-flash-medium", level: "high" });

  // User-picked reasoning effort overrides the "-high" preset; the model id stays the same
  const flashHigh = resolveAntigravityModel("gemini-3.8-flash-high");
  assert.equal(antigravityThinkingConfig(flashHigh, undefined)?.thinkingConfig.thinkingBudget, 24576);
  assert.equal(antigravityThinkingConfig(flashHigh, "low")?.thinkingConfig.thinkingBudget, 1024);
  assert.equal(antigravityThinkingConfig(flashHigh, "medium")?.thinkingConfig.thinkingBudget, 8192);
  assert.equal(antigravityThinkingConfig(flashHigh, "off"), null);
  const lowEnvelope = buildAntigravityEnvelope(
    { model: "gemini-3.8-flash-high", messages: [{ role: "user", content: "hi" }], reasoningEffort: "low" },
    "p"
  ) as { model: string; request: { generationConfig: { thinkingConfig?: { thinkingBudget?: number } } } };
  assert.equal(lowEnvelope.model, "gemini-3.8-flash-high");
  assert.equal(lowEnvelope.request.generationConfig.thinkingConfig?.thinkingBudget, 1024);

  assert(isAntigravityPlaceholderModel("MODEL_PLACEHOLDER_M319"));
  assert(!isAntigravityPlaceholderModel("claude-sonnet-5-5-high"));
  console.log("✓ Model ids resolve to served upstream ids; placeholder models are rejected");
}

async function testPlaceholderPing() {
  const result = await pingAntigravityModel({ accessToken: "x", headers: {} }, "MODEL_PLACEHOLDER_M319");
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /placeholder/i);
  console.log("✓ Ping short-circuits placeholder models without calling Google");
}

function testProviderRegistry() {
  assert(isOAuthProviderId("antigravity"));
  const manifest = OAUTH_PROVIDERS.antigravity;
  assert(manifest);
  assert.equal(manifest.id, "antigravity");
  assert.equal(manifest.flow, "pkce");
  assert.equal(manifest.defaultCustomHeaders["User-Agent"], "antigravity/ide/2.22.0 darwin/arm64");
  console.log("✓ Antigravity provider is registered in OAUTH_PROVIDERS manifest");
}

async function main() {
  console.log("Running Google Antigravity (Cloud Code Assist) E2E Test Suite...\n");
  testAuthorizeUrl();
  testSessionIdAndRequestId();
  testSchemaSanitizer();
  testEnvelopeBuilder();
  testModelResolution();
  await testPlaceholderPing();
  testParser();
  testQuotaSplit();
  testProviderRegistry();
  console.log("\nAll Google Antigravity tests passed successfully! 🚀");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
