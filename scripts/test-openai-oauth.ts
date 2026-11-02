import assert from "node:assert/strict";
import {
  OPENAI_AUTH_URL,
  OPENAI_OAUTH_CLIENT_ID,
  OPENAI_REDIRECT_URI,
  OPENAI_SCOPE,
  OPENAI_DEFAULT_CUSTOM_HEADERS,
  CODEX_DEFAULT_INSTRUCTIONS,
} from "../src/lib/oauth/constants/openai";
import {
  buildOpenAiAuthorizeUrl,
  extractChatGptAccountInfo,
  mapOpenAiTokens,
  startOpenAiPkceFlow,
} from "../src/lib/oauth/openai-oauth";
import {
  buildOpenAiCodexHeaders,
  buildOpenAiCodexParamOverrides,
  prepareCodexMessages,
} from "../src/lib/gateways/oauth-dispatch";
import {
  fetchOpenAiQuota,
  fetchOpenAiResetCredits,
  fetchOpenAiResetCreditsHistory,
  consumeOpenAiResetCredit,
} from "../src/lib/oauth/quota/openai";
import { isOAuthProviderId, OAUTH_PROVIDERS } from "../src/lib/oauth/providers";
import { CACHE_KEYS, CACHE_TTL } from "../src/lib/redis/cache-keys";
import { MAX_BULK_ACCOUNTS, parseBulkImportPayload } from "../src/lib/gateways/bulk-import-service";
import type { GatewayExecutionRequest } from "../src/lib/gateways/types";

function makeFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

async function runOpenAiTests() {
  console.log("=== 10. OpenAI Manifest & Authorize URL Test ===");
  assert.strictEqual(isOAuthProviderId("openai"), true, "openai is a registered oauth provider");
  const manifest = OAUTH_PROVIDERS.openai;
  assert.strictEqual(manifest.name, "OpenAI (ChatGPT)");
  assert.strictEqual(manifest.flow, "pkce");
  assert.strictEqual(manifest.wireApi, "responses");
  assert.strictEqual(manifest.iconKey, "openai");

  const started = startOpenAiPkceFlow();
  assert.ok(started.authUrl.startsWith(OPENAI_AUTH_URL));
  assert.ok(started.authUrl.includes(`client_id=${OPENAI_OAUTH_CLIENT_ID}`));
  assert.ok(started.authUrl.includes("redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback"));
  assert.ok(started.authUrl.includes("id_token_add_organizations=true"));
  assert.ok(started.authUrl.includes("codex_cli_simplified_flow=true"));
  assert.ok(started.authUrl.includes("originator=codex_cli_rs"));
  assert.strictEqual(new URL(started.authUrl).searchParams.get("scope"), OPENAI_SCOPE);
  assert.ok(started.codeVerifier.length > 40);
  assert.strictEqual(started.redirectUri, OPENAI_REDIRECT_URI);

  const customUrl = buildOpenAiAuthorizeUrl("custom-state", "custom-challenge");
  assert.ok(customUrl.includes("state=custom-state"));
  assert.ok(customUrl.includes("code_challenge=custom-challenge"));
  console.log("✔ Manifest registered, authorize URL contains Codex CLI parameters and localhost:1455 redirect");

  console.log("=== 11. OpenAI JWT Payload & Account Extraction Test ===");
  const fakeIdToken = makeFakeJwt({
    sub: "auth0|user_12345",
    email: "test@example.com",
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acc_chatgpt_67890",
      chatgpt_plan_type: "plus",
    },
  });
  const info = extractChatGptAccountInfo(fakeIdToken);
  assert.strictEqual(info.email, "test@example.com");
  assert.strictEqual(info.chatgptAccountId, "acc_chatgpt_67890");
  assert.strictEqual(info.chatgptPlanType, "plus");

  const fakeAccessToken = makeFakeJwt({
    sub: "user_access_token_sub",
    email: "access@example.com",
  });
  const mapped = mapOpenAiTokens({
    access_token: fakeAccessToken,
    id_token: fakeIdToken,
    refresh_token: "rt_secret_123",
    expires_in: 3600,
    scope: OPENAI_SCOPE,
  });
  assert.strictEqual(mapped.accessToken, fakeAccessToken);
  assert.strictEqual(mapped.refreshToken, "rt_secret_123");
  assert.strictEqual(mapped.email, "test@example.com");
  assert.strictEqual(mapped.upstreamUserId, "auth0|user_12345");
  assert.deepStrictEqual(mapped.providerData, {
    authMethod: "pkce",
    chatgptAccountId: "acc_chatgpt_67890",
    chatgptPlanType: "plus",
  });

  // Fallback test: no id_token
  const minimalMapped = mapOpenAiTokens({ access_token: fakeAccessToken });
  assert.strictEqual(minimalMapped.email, "access@example.com");
  assert.deepStrictEqual(minimalMapped.providerData, {
    authMethod: "pkce",
    chatgptAccountId: null,
    chatgptPlanType: null,
  });
  console.log("✔ ChatGPT account ID, plan type, and upstream sub extracted correctly from claims");

  console.log("=== 12. Codex Headers, Overrides, & Default Instructions ===");
  const mockConn = {
    id: 42n,
    providerData: { chatgptAccountId: "acc_corp_999" },
  };
  const mockReq: GatewayExecutionRequest = {
    model: "gpt-5-codex",
    messages: [{ role: "user", content: "Write a quicksort in Rust" }],
    stream: true,
    reasoningEffort: "medium",
  };
  const headers = buildOpenAiCodexHeaders(mockConn, mockReq, { "x-custom-foo": "bar" });
  assert.strictEqual(headers.originator, OPENAI_DEFAULT_CUSTOM_HEADERS.originator);
  assert.strictEqual(headers["User-Agent"], OPENAI_DEFAULT_CUSTOM_HEADERS["User-Agent"]);
  assert.strictEqual(headers.version, OPENAI_DEFAULT_CUSTOM_HEADERS.version);
  assert.strictEqual(headers["ChatGPT-Account-ID"], "acc_corp_999");
  assert.strictEqual(headers["x-custom-foo"], "bar");
  assert.ok(headers.session_id && headers.session_id.length > 10, "session_id should be deterministic uuid");

  const overrides = buildOpenAiCodexParamOverrides(mockReq);
  assert.strictEqual(overrides.store, false, "store must be false");
  assert.strictEqual(overrides.temperature, undefined, "temperature must be stripped");
  assert.strictEqual(overrides.top_p, undefined, "top_p must be stripped");
  assert.strictEqual(overrides.max_output_tokens, undefined, "max_output_tokens must be stripped");
  assert.deepStrictEqual(overrides.include, ["reasoning.encrypted_content"]);
  assert.deepStrictEqual(overrides.reasoning, { effort: "medium", summary: "auto" });

  const reasoningOffOverrides = buildOpenAiCodexParamOverrides({
    ...mockReq,
    reasoningEffort: "off",
  });
  assert.strictEqual(reasoningOffOverrides.reasoning, undefined);
  assert.strictEqual(reasoningOffOverrides.include, undefined);

  // Default instructions injection
  const preparedNoSys = prepareCodexMessages(mockReq.messages);
  assert.strictEqual(preparedNoSys.length, 2);
  assert.strictEqual(preparedNoSys[0].role, "system");
  assert.strictEqual(preparedNoSys[0].content, CODEX_DEFAULT_INSTRUCTIONS);

  // Preserve existing system message
  const preparedWithSys = prepareCodexMessages([
    { role: "system", content: "You are a senior Rust mentor." },
    { role: "user", content: "hi" },
  ]);
  assert.strictEqual(preparedWithSys.length, 2);
  assert.strictEqual(preparedWithSys[0].content, "You are a senior Rust mentor.");
  console.log("✔ Identity headers, parameter stripping, reasoning overrides, and instructions validated");

  console.log("=== 13. Codex Usage & Quota Parsing (Mocked Fetch) ===");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/backend-api/wham/usage")) {
        return new Response(
          JSON.stringify({
            plan_type: "team",
            rate_limit: {
              primary_window: { used_percent: 25.5, reset_at: 1770000000 },
              secondary_window: { used_percent: 80, resets_at: "2026-07-01T00:00:00.000Z" },
              limit_reached: false,
            },
            rate_limit_reset_credits: {
              available_count: 3,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    const quota = await fetchOpenAiQuota("token_xyz", { chatgptAccountId: "acc_1" });
    assert.strictEqual(quota.supported, true);
    assert.strictEqual(quota.plan, "team");
    assert.strictEqual(quota.resetCreditsAvailable, 3);
    assert.strictEqual(quota.exhausted, false);
    assert.ok(quota.quotas.session);
    assert.strictEqual(quota.quotas.session.used, 25.5);
    assert.strictEqual(quota.quotas.session.remainingPercentage, 74.5);
    assert.ok(quota.quotas.weekly);
    assert.strictEqual(quota.quotas.weekly.remainingPercentage, 20);
    console.log("✔ Usage windows, remaining percentages, and available reset credits parsed correctly");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("=== 14. Reset Credits Availability & Tolerant History Parsing ===");
  try {
    // 14A. Availability endpoint
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/rate-limit-reset-credits")) {
        return new Response(
          JSON.stringify({
            available_count: 2,
            credits: [
              { status: "available", granted_at: 1770000000, expires_at: 1772592000 },
              { status: "available", grantedAt: "2026-06-01T00:00:00.000Z", expiresAt: "2026-07-01T00:00:00.000Z" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    const avail = await fetchOpenAiResetCredits("token_xyz");
    assert.strictEqual(avail.availableCount, 2);
    assert.strictEqual(avail.credits.length, 2);
    assert.strictEqual(avail.credits[0].status, "available");
    assert.ok(avail.credits[0].grantedAt?.startsWith("2026-"));
    assert.strictEqual(avail.credits[1].expiresAt, "2026-07-01T00:00:00.000Z");

    // 14B. Real upstream ChatGPT history payload
    const realUpstreamPayload = {
      events: [
        {
          id: "RateLimitResetCredit_cbf29b1ccb3481918883f14b686525df:granted",
          kind: "granted",
          occurred_at: "2026-11-01T22:15:43.149778Z",
        },
        {
          id: "RateLimitResetCredit_4d7e13d3924481918a501551a8da6266:granted",
          kind: "granted",
          occurred_at: "2026-10-31T20:34:40.176377Z",
        },
        {
          id: "RateLimitResetCredit_f6dcde3fe6748191a0c4423ea5947fe5:used",
          kind: "used",
          occurred_at: "2026-10-22T15:15:09.259127Z",
        },
        {
          id: "RateLimitResetCredit_d6f1f69f99e88191a753d3cdb7f05e19:used",
          kind: "used",
          occurred_at: "2026-10-20T15:22:00.640786Z",
        },
        {
          id: "RateLimitResetCredit_2ce1c7de699081919d812d497041c3be:granted",
          kind: "granted",
          occurred_at: "2026-10-07T23:09:26.129719Z",
        },
      ],
      window_start: "2026-10-03T22:37:45.402994Z",
      as_of: "2026-11-02T22:37:45.402994Z",
      next_cursor: null,
    };

    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/rate-limit-reset-credits/history")) {
        return new Response(JSON.stringify(realUpstreamPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    const histReal = await fetchOpenAiResetCreditsHistory("token_xyz");
    assert.strictEqual(histReal.items.length, 5);
    assert.strictEqual(histReal.items[0].kind, "granted");
    assert.strictEqual(histReal.items[0].creditId, "RateLimitResetCredit_cbf29b1ccb3481918883f14b686525df");
    assert.strictEqual(histReal.items[0].occurredAt, "2026-11-01T22:15:43.149Z");
    assert.strictEqual(histReal.items[2].kind, "used");
    assert.strictEqual(histReal.items[2].creditId, "RateLimitResetCredit_f6dcde3fe6748191a0c4423ea5947fe5");
    assert.strictEqual(histReal.windowStart, "2026-10-03T22:37:45.402Z");
    assert.strictEqual(histReal.asOf, "2026-11-02T22:37:45.402Z");
    assert.strictEqual(histReal.nextCursor, null);

    // 14C. Fallback root array shape
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/rate-limit-reset-credits/history")) {
        return new Response(
          JSON.stringify([
            {
              id: "RateLimitResetCredit_fallback:used",
              kind: "used",
              occurred_at: "2026-05-15T12:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    const histFallback = await fetchOpenAiResetCreditsHistory("token_xyz");
    assert.strictEqual(histFallback.items.length, 1);
    assert.strictEqual(histFallback.items[0].kind, "used");
    assert.strictEqual(histFallback.items[0].creditId, "RateLimitResetCredit_fallback");

    console.log("✔ Real ChatGPT history payload (events, kind, occurred_at, window_start, as_of) parsed 100%");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("=== 15. Consume Reset Credit Mapping Test ===");
  try {
    // 15A. Success scenario (code: 'reset')
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ code: "reset", windows_reset: 2, message: "Limit has been reset" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    const resSuccess = await consumeOpenAiResetCredit("token_xyz", "uuid-1", { chatgptAccountId: "acc_1" });
    assert.strictEqual(resSuccess.ok, true);
    assert.strictEqual(resSuccess.noCredit, false);
    assert.strictEqual(resSuccess.code, "reset");
    assert.strictEqual(resSuccess.windowsReset, 2);

    // 15B. No credit scenario (code: 'no_credit')
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ code: "no_credit", message: "No available credits" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    const resNoCredit = await consumeOpenAiResetCredit("token_xyz", "uuid-2");
    assert.strictEqual(resNoCredit.ok, false);
    assert.strictEqual(resNoCredit.noCredit, true);
    assert.strictEqual(resNoCredit.code, "no_credit");

    // 15C. Upstream HTTP 400 failure
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ error: { message: "Invalid redeem request" } }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    const resFailed = await consumeOpenAiResetCredit("token_xyz", "uuid-3");
    assert.strictEqual(resFailed.ok, false);
    assert.strictEqual(resFailed.noCredit, false);
    assert.strictEqual(resFailed.status, 400);
    assert.ok(resFailed.message?.includes("Invalid redeem request"));

    console.log("✔ Consume credit mapping: ok on 'reset', noCredit on 'no_credit', upstream error captured");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("=== 16. Reset Credits Cache Keys & TTL ===");
  assert.strictEqual(CACHE_TTL.OPENAI_RESET_CREDITS, 300, "cache lives 5 minutes");
  assert.strictEqual(
    CACHE_KEYS.openaiResetCredits(42n),
    "cache:admin:provider_connection:42:reset_credits"
  );
  assert.strictEqual(
    CACHE_KEYS.openaiResetCreditsHistory("42"),
    "cache:admin:provider_connection:42:reset_credits_history"
  );
  assert.notStrictEqual(CACHE_KEYS.openaiResetCredits(1n), CACHE_KEYS.openaiResetCredits(2n), "per-connection keys");
  console.log("✔ Availability & history cached per connection for 5 minutes");

  console.log("=== 17. Bulk Import Payload Parsing ===");
  const expSec = Math.floor(Date.UTC(2026, 11, 1) / 1000);
  const bulkAccess = makeFakeJwt({ sub: "user_bulk_access", exp: expSec });
  const bulkIdA = makeFakeJwt({
    sub: "auth0|bulk_a",
    email: "a@example.com",
    "https://api.openai.com/auth": { chatgpt_account_id: "acc_A", chatgpt_plan_type: "pro" },
  });
  const bulkIdB = makeFakeJwt({
    sub: "auth0|bulk_b",
    email: "b@example.com",
    "https://api.openai.com/auth": { chatgpt_account_id: "acc_B", chatgpt_plan_type: "plus" },
  });

  // Array: camelCase, snake_case, missing token, intra-batch duplicate
  const parsedArr = parseBulkImportPayload([
    { accessToken: bulkAccess, refreshToken: "rt_a", idToken: bulkIdA },
    { access_token: bulkAccess, refresh_token: "rt_b", id_token: bulkIdB, label: "Tim B" },
    { refreshToken: "rt_only" },
    { accessToken: bulkAccess, idToken: bulkIdA },
  ]);
  assert.strictEqual(parsedArr.items.length, 2);
  assert.deepStrictEqual(parsedArr.items.map((it) => it.index), [0, 1], "original input index kept");
  const a = parsedArr.items[0];
  assert.strictEqual(a.email, "a@example.com", "email backfilled from id_token");
  assert.strictEqual(a.chatgptAccountId, "acc_A");
  assert.strictEqual(a.chatgptPlanType, "pro");
  assert.strictEqual(a.upstreamUserId, "auth0|bulk_a");
  assert.strictEqual(a.expiresAt?.getTime(), expSec * 1000, "expiresAt falls back to access token exp");
  assert.strictEqual(parsedArr.items[1].refreshToken, "rt_b", "snake_case accepted");
  assert.strictEqual(parsedArr.items[1].label, "Tim B");
  assert.deepStrictEqual(parsedArr.errors.map((e) => e.index), [2, 3]);
  assert.ok(parsedArr.errors[0].error.includes("accessToken"));
  assert.ok(parsedArr.errors[1].error.includes("Duplikat"));

  // { accounts: [...] } wrapper + explicit expiresIn
  const parsedWrapped = parseBulkImportPayload({ accounts: [{ accessToken: bulkAccess, expiresIn: 3600 }] });
  assert.strictEqual(parsedWrapped.items.length, 1);
  const inMs = (parsedWrapped.items[0].expiresAt?.getTime() ?? 0) - Date.now();
  assert.ok(inMs > 3500_000 && inMs <= 3600_000, "expiresIn wins over JWT exp");

  // Codex CLI auth.json (single object)
  const parsedAuthJson = parseBulkImportPayload({
    OPENAI_API_KEY: null,
    tokens: { access_token: bulkAccess, refresh_token: "rt_cli", id_token: bulkIdB, account_id: "acc_cli" },
  });
  assert.strictEqual(parsedAuthJson.items.length, 1);
  assert.strictEqual(parsedAuthJson.items[0].refreshToken, "rt_cli");
  assert.strictEqual(parsedAuthJson.items[0].chatgptAccountId, "acc_cli", "auth.json account_id wins");
  assert.strictEqual(parsedAuthJson.items[0].email, "b@example.com");

  // Limits
  assert.throws(() => parseBulkImportPayload([]), /Tidak ada akun/);
  const tooMany = Array.from({ length: MAX_BULK_ACCOUNTS + 1 }, () => ({ accessToken: bulkAccess }));
  assert.throws(() => parseBulkImportPayload(tooMany), /Maksimal/);
  console.log("✔ Bulk parser: shapes, snake_case, JWT backfill, expiry, duplicates & limits validated");

  console.log("\nALL OPENAI / CODEX CLI TESTS PASSED 100%! 🎉");
}

runOpenAiTests().catch((err) => {
  console.error("OpenAI test failed:", err);
  process.exit(1);
});
