import assert from "node:assert/strict";
import {
  OPENAI_FREE_PLAN_ALLOWED_MODELS,
  isOpenAiModelAllowedForFree,
  isConnectionQuotaExhausted,
  getConnectionPlanType,
  normalizeModelKey,
  executeOAuthGateway,
  type PoolConnection,
} from "../src/lib/gateways/oauth-dispatch";
import { GatewayError } from "../src/lib/routing/errors";
import type { DecryptedGatewayConfig, GatewayExecutionRequest, GatewayStreamEvent } from "../src/lib/gateways/types";

async function runCandidateFilterTests() {
  console.log("=== 1. Model Normalization & Green/Red Checks ===");
  assert.strictEqual(normalizeModelKey("cx/gpt-5.6-terra"), "gpt-5.6-terra");
  assert.strictEqual(normalizeModelKey("CX/GPT-6-LUNA[1M]"), "gpt-6-luna[1m]");
  assert.strictEqual(normalizeModelKey("  gpt-reserve  "), "gpt-reserve");

  // All 10 green models from user image & confirmation
  const greenModels = [
    "gpt-6-luna",
    "gpt-6-luna[1m]",
    "gpt-5.6-terra",
    "gpt-5.6-terra[1m]",
    "gpt-5.6-terra-review",
    "gpt-5.6-luna",
    "gpt-5.6-luna[1m]",
    "gpt-5.6-luna-review",
    "gpt-reserve",
    "codex-auto-review",
  ];
  assert.strictEqual(OPENAI_FREE_PLAN_ALLOWED_MODELS.size, greenModels.length);
  for (const gm of greenModels) {
    assert.strictEqual(isOpenAiModelAllowedForFree(gm), true, `${gm} must be allowed on free`);
    assert.strictEqual(isOpenAiModelAllowedForFree(`cx/${gm}`), true, `cx/${gm} must be allowed on free`);
  }

  // Red models (forbidden on free plan)
  const redModels = [
    "gpt-6.1-sol",
    "cx/gpt-6.1-sol",
    "gpt-6-astra",
    "cx/gpt-6-astra[1m]",
    "gpt-6-sol",
    "cx/gpt-6-sol[1m]",
    "gpt-5.6-sol",
    "cx/gpt-5.6-sol[1m]",
    "gpt-5.6-sol-review",
    "gpt-daybreak-blue-latest",
    "cx/gpt-daybreak-blue-latest",
  ];
  for (const rm of redModels) {
    assert.strictEqual(isOpenAiModelAllowedForFree(rm), false, `${rm} must be forbidden on free`);
  }
  console.log("âœ” 10 green models allowed for free tier; red models correctly rejected with/without cx/ prefix");

  console.log("=== 2. Quota Exhaustion Detection ===");
  const activeConn: PoolConnection = {
    id: 1n,
    email: "active@example.com",
    upstreamUserId: "sub_1",
    expiresAt: null,
    hasRefreshToken: true,
    providerData: { chatgptPlanType: "plus" },
    quotaCached: {
      supported: true,
      exhausted: false,
      quotas: {
        session: { used: 10, total: 100, remainingPercentage: 90, resetAt: null, unlimited: false },
        weekly: { used: 50, total: 100, remainingPercentage: 50, resetAt: null, unlimited: false },
      },
    },
  };
  assert.strictEqual(isConnectionQuotaExhausted(activeConn), false);

  const depletedSessionConn: PoolConnection = {
    ...activeConn,
    id: 2n,
    quotaCached: {
      supported: true,
      exhausted: false,
      quotas: {
        session: {
          used: 100,
          total: 100,
          remainingPercentage: 0,
          resetAt: new Date(Date.now() + 3600_000).toISOString(),
          unlimited: false,
        },
      },
    },
  };
  assert.strictEqual(isConnectionQuotaExhausted(depletedSessionConn), true);

  // But if resetAt is in the past, it's eligible again
  const pastResetConn: PoolConnection = {
    ...activeConn,
    id: 3n,
    quotaCached: {
      supported: true,
      exhausted: false,
      quotas: {
        session: {
          used: 100,
          total: 100,
          remainingPercentage: 0,
          resetAt: new Date(Date.now() - 60_000).toISOString(),
          unlimited: false,
        },
      },
    },
  };
  assert.strictEqual(isConnectionQuotaExhausted(pastResetConn), false);
  console.log("âœ” Quota exhaustion checked against session/weekly remaining % and reset timestamp");

  console.log("=== 3. Plan Type Extraction ===");
  assert.strictEqual(getConnectionPlanType(activeConn), "plus");
  assert.strictEqual(
    getConnectionPlanType({ ...activeConn, providerData: null, quotaCached: { supported: true, plan: "Free", quotas: {}, exhausted: false } }),
    "free"
  );
  console.log("âœ” Plan type extracted case-insensitively from providerData, fallback quotaCached");

  console.log("=== 4. Pool Candidate Filtering in Dispatcher ===");
  const mockGw: DecryptedGatewayConfig = {
    id: 200n,
    slug: "oauth-openai",
    name: "OpenAI (ChatGPT)",
    baseUrl: "https://chatgpt.com/backend-api/codex",
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
    oauthProvider: "openai",
  };

  const freeConn: PoolConnection = {
    id: 10n,
    email: "free@example.com",
    upstreamUserId: "sub_free",
    expiresAt: null,
    hasRefreshToken: true,
    providerData: { chatgptPlanType: "free" },
    quotaCached: null,
  };

  const plusConn: PoolConnection = {
    id: 20n,
    email: "plus@example.com",
    upstreamUserId: "sub_plus",
    expiresAt: null,
    hasRefreshToken: true,
    providerData: { chatgptPlanType: "plus" },
    quotaCached: null,
  };

  const exhaustedPlusConn: PoolConnection = {
    id: 30n,
    email: "exhausted@example.com",
    upstreamUserId: "sub_ex",
    expiresAt: null,
    hasRefreshToken: true,
    providerData: { chatgptPlanType: "plus" },
    quotaCached: {
      supported: true,
      exhausted: true,
      periodEnd: new Date(Date.now() + 3600_000).toISOString(),
      quotas: {},
    },
  };

  const testPool = [freeConn, plusConn, exhaustedPlusConn];

  // 4A. Red model requested (gpt-6.1-sol): free account must be skipped, exhausted must be skipped, plus must be picked
  const redReq: GatewayExecutionRequest = {
    model: "cx/gpt-6.1-sol",
    messages: [{ role: "user", content: "hi" }],
  };

  const triedAccounts: string[] = [];
  const mockInner = async function* (gw: DecryptedGatewayConfig) {
    triedAccounts.push(gw.apiKey);
    yield { type: "delta" as const, text: "ok" };
  };

  const streamRed = executeOAuthGateway(mockGw, redReq, mockInner, {
    loadPool: async () => testPool,
    getToken: async (id) => `token_${id}`,
    onCommitted: async () => {},
    onError: async () => {},
  });
  const collectedRed: GatewayStreamEvent[] = [];
  for await (const ev of streamRed) collectedRed.push(ev);

  assert.strictEqual(collectedRed.length, 1);
  assert.deepStrictEqual(triedAccounts, ["token_20"], "Only Plus account was eligible for red model");

  // 4B. Green model requested (gpt-5.6-terra): Free account is eligible and comes first (sortOrder/id order)
  triedAccounts.length = 0;
  const greenReq: GatewayExecutionRequest = {
    model: "gpt-5.6-terra",
    messages: [{ role: "user", content: "hi" }],
  };
  const streamGreen = executeOAuthGateway(mockGw, greenReq, mockInner, {
    loadPool: async () => testPool,
    getToken: async (id) => `token_${id}`,
    onCommitted: async () => {},
    onError: async () => {},
  });
  for await (const ev of streamGreen) void ev;
  assert.deepStrictEqual(triedAccounts, ["token_10"], "Free account was picked first for green model");

  // 4C. Red model requested when only Free accounts exist: throws informative GatewayError
  const streamNoPaid = executeOAuthGateway(mockGw, redReq, mockInner, {
    loadPool: async () => [freeConn],
    getToken: async (id) => `token_${id}`,
    onCommitted: async () => {},
    onError: async () => {},
  });
  await assert.rejects(
    async () => {
      for await (const _ of streamNoPaid) void _;
    },
    (e: unknown) =>
      e instanceof GatewayError &&
      e.providerError.includes("plan free tidak mendukung model")
  );

  // 4D. Green model requested when only exhausted accounts exist: throws rate_limited error
  const streamExhaustedOnly = executeOAuthGateway(mockGw, greenReq, mockInner, {
    loadPool: async () => [exhaustedPlusConn],
    getToken: async (id) => `token_${id}`,
    onCommitted: async () => {},
    onError: async () => {},
  });
  await assert.rejects(
    async () => {
      for await (const _ of streamExhaustedOnly) void _;
    },
    (e: unknown) =>
      e instanceof GatewayError &&
      e.errorClass === "rate_limited" &&
      e.providerError.includes("kuota habis")
  );

  console.log("âœ” Candidate filtering in dispatcher: free skipped on red, picked on green, exhausted skipped");
  console.log("\nALL CANDIDATE FILTER TESTS PASSED 100%! ðŸŽ‰");
}

runCandidateFilterTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
