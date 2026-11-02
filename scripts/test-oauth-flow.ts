import assert from "node:assert/strict";
import { generatePKCE } from "../src/lib/oauth/pkce";
import {
  buildXaiAuthorizeUrl,
  isOAuthProviderId,
} from "../src/lib/oauth/providers";
import { parseCallbackInput } from "../src/lib/oauth/callback-input";
import {
  extractEmailFromToken,
  extractUserIdFromToken,
  needsTokenRefresh,
} from "../src/lib/oauth/token-refresh";
import {
  buildGrokCliHeaders,
  buildGrokCliParamOverrides,
  supportsGrokCliReasoningEffort,
  executeOAuthGateway,
} from "../src/lib/gateways/oauth-dispatch";
import { isQuotaSupported } from "../src/lib/oauth/quota";
import { detectCapabilities, mergeModelLists, parseModelList } from "../src/lib/oauth/model-capabilities";
import { GatewayError } from "../src/lib/routing/errors";
import type { DecryptedGatewayConfig, GatewayExecutionRequest, GatewayStreamEvent } from "../src/lib/gateways/types";

async function runTests() {
  console.log("=== 1. PKCE Generation Test ===");
  const pkce = generatePKCE(96);
  assert.ok(pkce.codeVerifier.length >= 120, "Verifier length should be base64url 96 bytes");
  assert.ok(pkce.codeChallenge.length >= 40, "Challenge should be S256 base64url");
  assert.ok(pkce.state.length >= 40, "State should be random");
  console.log("✔ PKCE generated valid verifier, challenge, state");

  console.log("=== 2. Authorize URL & Manifest Test ===");
  assert.strictEqual(isOAuthProviderId("xai"), true);
  assert.strictEqual(isOAuthProviderId("grok-cli"), true);
  assert.strictEqual(isOAuthProviderId("unknown"), false);

  const authUrl = buildXaiAuthorizeUrl(pkce.state, pkce.codeChallenge);
  assert.ok(authUrl.startsWith("https://auth.x.ai/oauth2/authorize?"));
  assert.ok(authUrl.includes("client_id=b1a00492-073a-47ea-816f-4c329264a828"));
  assert.ok(authUrl.includes("redirect_uri=http%3A%2F%2F127.0.0.1%3A56121%2Fcallback"));
  assert.ok(authUrl.includes("code_challenge_method=S256"));
  assert.ok(authUrl.includes(`state=${encodeURIComponent(pkce.state)}`));
  console.log("✔ xAI Authorize URL contains exact client_id, PKCE S256, redirect_uri, and state");

  console.log("=== 3. Callback Input Parsing Test ===");
  // Full loopback URL
  const parsed1 = parseCallbackInput(
    "http://127.0.0.1:56121/callback?code=test-code-123&state=my-state-456"
  );
  assert.strictEqual(parsed1.code, "test-code-123");
  assert.strictEqual(parsed1.state, "my-state-456");

  // Query string alone
  const parsed2 = parseCallbackInput("code=test-code-789&state=abc");
  assert.strictEqual(parsed2.code, "test-code-789");
  assert.strictEqual(parsed2.state, "abc");

  // Raw code displayed on screen by xAI
  const parsed3 = parseCallbackInput("Itr1SD5mIMfqzGzaEnKD_byuZsMtCe4Uj_0dMZfdZ4cdwbD3L6DIz2OHudwmIh2iuanTSeFaDn0FAItMLjvBKA");
  assert.strictEqual(parsed3.code, "Itr1SD5mIMfqzGzaEnKD_byuZsMtCe4Uj_0dMZfdZ4cdwbD3L6DIz2OHudwmIh2iuanTSeFaDn0FAItMLjvBKA");
  assert.strictEqual(parsed3.state, null);
  console.log("✔ Callback input parsed full URL, query string, and raw code successfully");

  console.log("=== 4. Token Parsing & Refresh Checks ===");
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: "usr_999", email: "user@example.com", tier: 1 })
  ).toString("base64url");
  const mockJwt = `${header}.${payload}.sig`;

  assert.strictEqual(extractEmailFromToken(mockJwt), "user@example.com");
  assert.strictEqual(extractUserIdFromToken(mockJwt), "usr_999");

  const futureDate = new Date(Date.now() + 600 * 1000);
  assert.strictEqual(needsTokenRefresh(futureDate, 300), false);
  const nearExpiryDate = new Date(Date.now() + 100 * 1000);
  assert.strictEqual(needsTokenRefresh(nearExpiryDate, 300), true);
  console.log("✔ JWT extraction and proactive token refresh lead checks verified");

  console.log("=== 5. Grok CLI Headers & Overrides Test ===");
  const mockConn = { id: 1n, email: "grok@x.ai", upstreamUserId: "x_123" };
  const mockReq: GatewayExecutionRequest = {
    model: "grok-build",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Halo Grok!" },
    ],
    reasoningEffort: "high",
  };
  const headers = buildGrokCliHeaders(mockConn, mockReq, { "Custom-Trace": "true" });
  assert.strictEqual(headers["x-xai-token-auth"], "xai-grok-cli");
  assert.strictEqual(headers["x-grok-client-identifier"], "grok-shell");
  assert.strictEqual(headers["x-grok-client-version"], "1.0.44");
  assert.strictEqual(headers["x-email"], "grok@x.ai");
  assert.strictEqual(headers["x-userid"], "x_123");
  assert.strictEqual(headers["x-grok-turn-idx"], "1");
  assert.strictEqual(headers["Custom-Trace"], "true");

  const overrides = buildGrokCliParamOverrides(mockReq);
  assert.strictEqual(overrides.store, false);
  assert.deepStrictEqual((overrides.reasoning as Record<string, unknown>).summary, "concise");
  assert.strictEqual(supportsGrokCliReasoningEffort("grok-4.5"), true);
  assert.strictEqual(supportsGrokCliReasoningEffort("grok-build"), false);
  console.log("✔ Grok CLI spoofing headers and Responses body overrides verified");

  console.log("=== 6. Quota Registry Check ===");
  assert.strictEqual(isQuotaSupported("grok-cli"), true);
  assert.strictEqual(isQuotaSupported("xai"), false);
  console.log("✔ Quota support flags correct (grok-cli: true, xai: false)");

  console.log("=== 7. Dispatcher Pool & Account Fallback Test ===");
  const mockGw: DecryptedGatewayConfig = {
    id: 100n,
    slug: "oauth-grok-cli",
    name: "Grok CLI (Grok Build)",
    baseUrl: "https://cli-chat-proxy.grok.com/v1",
    wireApi: "responses",
    modelsPath: "/models",
    apiKey: "dummy",
    extraHeaders: null,
    isPrimary: false,
    isEnabled: true,
    priority: 100,
    timeoutMs: 120000,
    firstTokenTimeoutMs: 20000,
    healthStatus: "healthy",
    consecutiveFailures: 0,
    circuitOpenUntil: null,
    authType: "oauth",
    oauthProvider: "grok-cli",
  };

  const pool = [
    {
      id: 1n,
      email: "acc1@x.ai",
      upstreamUserId: "u1",
      expiresAt: null,
      hasRefreshToken: false,
      quotaCached: null,
      providerData: null,
    },
    {
      id: 2n,
      email: "acc2@x.ai",
      upstreamUserId: "u2",
      expiresAt: null,
      hasRefreshToken: false,
      quotaCached: null,
      providerData: null,
    },
  ];

  const triedAccounts: string[] = [];
  const mockInner = async function* (gw: DecryptedGatewayConfig) {
    triedAccounts.push(gw.apiKey);
    if (gw.apiKey === "token_for_acc_1") {
      throw new GatewayError({
        errorClass: "rate_limited",
        httpStatus: 429,
        message: "Account 1 rate limited",
      });
    }
    yield { type: "delta" as const, text: "Hello from account 2" };
  };

  let errorRecorded = false;
  let committedRecorded = false;

  const stream = executeOAuthGateway(mockGw, mockReq, mockInner, {
    loadPool: async () => pool,
    getToken: async (id) => `token_for_acc_${id}`,
    onError: async (id, err, cooldown) => {
      errorRecorded = true;
      assert.strictEqual(id, 1n);
      assert.ok(cooldown !== null);
    },
    onCommitted: async (id) => {
      committedRecorded = true;
      assert.strictEqual(id, 2n);
    },
  });

  const events: GatewayStreamEvent[] = [];
  for await (const evt of stream) {
    events.push(evt);
  }

  assert.deepStrictEqual(triedAccounts, ["token_for_acc_1", "token_for_acc_2"]);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, "delta");
  assert.strictEqual((events[0] as { text: string }).text, "Hello from account 2");
  assert.strictEqual(errorRecorded, true, "Account 1 rate limit was noted with cooldown");
  assert.strictEqual(committedRecorded, true, "Account 2 commitment was noted");
  console.log("✔ OAuth Pool fallback: account 1 rate-limit gracefully failed over to account 2");

  console.log("=== 8. 401 refresh-once & mid-stream commit Test ===");
  const refreshPool = [{ ...pool[0], hasRefreshToken: true }, pool[1]];
  const forced: boolean[] = [];
  const seen: string[] = [];
  const refreshStream = executeOAuthGateway(
    mockGw,
    mockReq,
    async function* (gw: DecryptedGatewayConfig) {
      seen.push(gw.apiKey);
      if (gw.apiKey === "stale") {
        throw new GatewayError({ errorClass: "auth", httpStatus: 401, message: "expired" });
      }
      yield { type: "delta" as const, text: "ok" };
    },
    {
      loadPool: async () => refreshPool,
      getToken: async (_id, force) => {
        forced.push(force);
        return force ? "fresh" : "stale";
      },
      onError: async () => {},
      onCommitted: async () => {},
    }
  );
  for await (const _ of refreshStream) void _;
  assert.deepStrictEqual(seen, ["stale", "fresh"], "401 retried the same account with a refreshed token");
  assert.deepStrictEqual(forced, [false, true]);

  const midTried: string[] = [];
  const midStream = executeOAuthGateway(
    mockGw,
    mockReq,
    async function* (gw: DecryptedGatewayConfig) {
      midTried.push(gw.apiKey);
      yield { type: "delta" as const, text: "partial" };
      throw new GatewayError({ errorClass: "rate_limited", httpStatus: 429, message: "mid" });
    },
    {
      loadPool: async () => pool,
      getToken: async (id) => `t${id}`,
      onError: async () => {},
      onCommitted: async () => {},
    }
  );
  await assert.rejects(async () => {
    for await (const _ of midStream) void _;
  }, GatewayError);
  assert.deepStrictEqual(midTried, ["t1"], "no account switch after the first event");

  const emptyStream = executeOAuthGateway(mockGw, mockReq, mockInner, {
    loadPool: async () => [],
  });
  await assert.rejects(async () => {
    for await (const _ of emptyStream) void _;
  }, (e: unknown) => e instanceof GatewayError && e.errorClass === "auth");
  console.log("✔ 401 refreshes once, mid-stream errors never switch accounts, empty pool fails as auth");

  console.log("=== 9. Model List Parsing & Capability Detection ===");
  const list = parseModelList({
    data: [
      { id: "grok-4.7", object: "model", owned_by: "xai" },
      { id: "grok-imagine-image", owned_by: "xai" },
      { id: "grok-4-fast-non-reasoning" },
      { id: "grok-4.7" },
    ],
  });
  assert.strictEqual(list.length, 3, "duplicate ids are dropped");
  const g47 = list.find((m) => m.modelKey === "grok-4.7")!;
  assert.strictEqual(g47.capabilities.reasoning, true);
  assert.strictEqual(g47.capabilities.vision, true);
  assert.strictEqual(g47.capabilities.source, "heuristic");
  const img = list.find((m) => m.modelKey === "grok-imagine-image")!;
  assert.deepStrictEqual(img.capabilities.output, ["image"]);
  assert.strictEqual(img.capabilities.reasoning, false);
  assert.strictEqual(list.find((m) => m.modelKey === "grok-4-fast-non-reasoning")!.capabilities.reasoning, false);

  const rich = parseModelList({
    models: [
      {
        id: "grok-4.7",
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
        context_length: 256000,
        supports_reasoning: true,
      },
    ],
  });
  const merged = mergeModelLists(list, rich);
  const mergedG47 = merged.find((m) => m.modelKey === "grok-4.7")!;
  assert.strictEqual(mergedG47.capabilities.source, "upstream");
  assert.strictEqual(mergedG47.capabilities.contextLength, 256000);
  assert.deepStrictEqual(mergedG47.capabilities.input, ["text", "image"]);

  const voice = detectCapabilities("some-tts", { output_modalities: ["speech"] });
  assert.deepStrictEqual(voice.output, ["audio"]);
  assert.deepStrictEqual(parseModelList(["a", "b"]).map((m) => m.modelKey), ["a", "b"]);
  console.log("✔ /models shapes parsed, duplicates dropped, upstream metadata beats id heuristics");

  console.log("\nALL CLI TESTS PASSED 100%! 🎉");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
