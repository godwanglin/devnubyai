import assert from "node:assert/strict";
import { orderCandidates } from "../src/lib/routing/strategy";
import type { CandidateRoute } from "../src/lib/gateways/types";
import type { RoutingSettings } from "../src/lib/routing/settings";

const dummySettings: RoutingSettings = {
  primaryFirst: true, // even if true in settings, orderCandidates should not override route priority
  maxAttempts: 3,
  retryOnStatus: [429, 500, 502, 503, 504],
  fallbackOnModelNotFound: true,
  fallbackOnErrors: ["network", "timeout", "http_5xx", "rate_limited", "auth", "bad_request"],
  circuitFailureThreshold: 5,
  circuitCooldownSeconds: 30,
  cacheTtlSeconds: 60,
  version: 1,
  defaultModel: "gpt-5.6-terra",
  requestRetryAttempts: 5,
  fallbackModelPattern: "auto",
};

function makeCandidate(id: number, name: string, isPrimary: boolean, priority: number): CandidateRoute {
  return {
    candidateId: BigInt(id),
    priority,
    weight: 1,
    paramOverrides: null,
    upstreamModelId: BigInt(id * 10),
    upstreamModelKey: "gpt-5.6-terra",
    gateway: {
      id: BigInt(id),
      slug: name.toLowerCase(),
      name,
      baseUrl: "https://api.example.com",
      wireApi: "chat",
      modelsPath: "/models",
      apiKey: "k",
      extraHeaders: null,
      authType: "oauth",
      oauthProvider: "openai",
      timeoutMs: 30000,
      firstTokenTimeoutMs: 15000,
      healthStatus: "healthy",
      consecutiveFailures: 0,
      circuitOpenUntil: null,
      isPrimary,
      isEnabled: true,
      priority,
    },
  };
}

async function main() {
  console.log("Testing Equal Gateway Priority Ordering...\n");

  const oauthRoute = makeCandidate(1, "OpenAI Codex OAuth (Direct)", false, 1);
  const proxyPrimaryRoute = makeCandidate(2, "9router Proxy (Legacy Primary)", true, 2);
  const backupRoute = makeCandidate(3, "Backup Gateway", false, 3);

  // In the DB, routes were sorted by priority: [oauthRoute (prio 1), proxyPrimaryRoute (prio 2), backupRoute (prio 3)]
  const ordered = await orderCandidates(
    {
      catalogModelId: 100n,
      strategy: "priority",
      candidates: [oauthRoute, proxyPrimaryRoute, backupRoute],
    },
    dummySettings
  );

  // Oauth route (prio 1) must remain FIRST, not overridden by proxyPrimaryRoute just because it has isPrimary: true
  assert.equal(ordered[0].gateway.name, "OpenAI Codex OAuth (Direct)");
  assert.equal(ordered[1].gateway.name, "9router Proxy (Legacy Primary)");
  assert.equal(ordered[2].gateway.name, "Backup Gateway");

  console.log("✓ Route priority is strictly respected: OAuth direct connection runs first!");
  console.log("✓ Legacy isPrimary flag no longer overrides candidate ordering.");
  console.log("\nAll equality routing tests passed! 🚀");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
