import "dotenv/config";
import http from "node:http";
import { db } from "../src/lib/db";
import { encryptSecret } from "../src/lib/crypto/vault";
import { resolveCandidates, clearCandidateCache } from "../src/lib/routing/resolver";
import { executeWithFallback } from "../src/lib/routing/executor";
import { resetCircuit } from "../src/lib/routing/circuit";
import { getRoutingSettings } from "../src/lib/routing/settings";
import { ApiError } from "../src/lib/api/response";

interface MockServerState {
  aMode: "500" | "429" | "timeout" | "ok";
  bMode: "500" | "404" | "ok";
  cMode: "ok" | "500";
  requestLog: string[];
}

const state: MockServerState = {
  aMode: "500",
  bMode: "ok",
  cMode: "ok",
  requestLog: [],
};

function sseEvent(deltaText: string): string {
  const payload = {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: Date.now(),
    model: "mock-model",
    choices: [{ index: 0, delta: { content: deltaText }, finish_reason: null }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseDone(): string {
  const payload = {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: Date.now(),
    model: "mock-model",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  };
  return `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
}

function startMockServer(port = 0): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url || "";
      state.requestLog.push(`${req.method} ${url}`);

      if (url.startsWith("/gw-a/")) {
        if (state.aMode === "500") {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Internal server error" } }));
          return;
        }
        if (state.aMode === "429") {
          res.writeHead(429, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Rate limit exceeded" } }));
          return;
        }
        if (state.aMode === "timeout") {
          // Never answer — let firstTokenTimeoutMs fire
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(sseEvent("Hello from A!"));
        res.end(sseDone());
        return;
      }

      if (url.startsWith("/gw-b/")) {
        if (state.bMode === "500") {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Gateway B 500" } }));
          return;
        }
        if (state.bMode === "404") {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Model not found" } }));
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(sseEvent("Hello from B!"));
        res.end(sseDone());
        return;
      }

      if (url.startsWith("/gw-c/")) {
        if (state.cMode === "500") {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Gateway C 500" } }));
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(sseEvent("Hello from C!"));
        res.end(sseDone());
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({ server, port: actualPort });
    });
    server.on("error", reject);
  });
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION_FAILED: ${message}`);
  }
}

async function collectStreamText(
  iterable: AsyncGenerator<{ type: string; [k: string]: unknown }>
): Promise<string> {
  const parts: string[] = [];
  for await (const ev of iterable) {
    if (ev.type === "delta" && typeof ev.text === "string") parts.push(ev.text);
  }
  return parts.join("");
}

async function run() {
  console.log("=== Phase 3 Smart Routing & Fallback Integration Test ===");
  const { server, port } = await startMockServer(0);
  const baseUrlA = `http://127.0.0.1:${port}/gw-a`;
  const baseUrlB = `http://127.0.0.1:${port}/gw-b`;
  const baseUrlC = `http://127.0.0.1:${port}/gw-c`;

  const dummyCiphertext = encryptSecret("mock-api-key");
  const testSlugPrefix = `test-gw-${Date.now()}`;
  const testPublicModelId = `test/model-${Date.now()}`;

  // Find existing primary gateway so we can swap back at the end
  const originalPrimary = await db.gateway.findFirst({
    where: { isPrimary: true },
  });

  let gwAId = 0n;
  let gwBId = 0n;
  let gwCId = 0n;
  let catalogModelId = 0n;

  try {
    // 0. Verify routing settings come from DB (no hardcoded fallback)
    const settings = await getRoutingSettings({ forceRefresh: true });
    console.log(`[0] DB routing settings loaded: maxAttempts=${settings.maxAttempts}, primaryFirst=${settings.primaryFirst}, threshold=${settings.circuitFailureThreshold}`);
    assert(settings.maxAttempts >= 3, "Expected maxAttempts >= 3 from DB settings");
    assert(Array.isArray(settings.retryOnStatus), "retryOnStatus is array");
    assert(Array.isArray(settings.fallbackOnErrors), "fallbackOnErrors is array");

    // 1. Setup 3 test gateways, upstream models, catalog model, routes
    console.log("[1] Creating temporary test gateways & routes in MariaDB...");
    const provider = await db.modelProvider.findFirstOrThrow();

    const gwA = await db.gateway.create({
      data: {
        slug: `${testSlugPrefix}-a`,
        name: "Test Gateway A",
        baseUrl: baseUrlA,
        wireApi: "chat",
        apiKeyCiphertext: dummyCiphertext,
        apiKeyLast4: "test",
        isPrimary: false,
        isEnabled: true,
        priority: 10,
        timeoutMs: 5000,
        firstTokenTimeoutMs: 1500,
        healthStatus: "healthy",
      },
    });
    gwAId = gwA.id;

    const gwB = await db.gateway.create({
      data: {
        slug: `${testSlugPrefix}-b`,
        name: "Test Gateway B",
        baseUrl: baseUrlB,
        wireApi: "chat",
        apiKeyCiphertext: dummyCiphertext,
        apiKeyLast4: "test",
        isPrimary: false,
        isEnabled: true,
        priority: 20,
        timeoutMs: 5000,
        firstTokenTimeoutMs: 1500,
        healthStatus: "healthy",
      },
    });
    gwBId = gwB.id;

    const gwC = await db.gateway.create({
      data: {
        slug: `${testSlugPrefix}-c`,
        name: "Test Gateway C",
        baseUrl: baseUrlC,
        wireApi: "chat",
        apiKeyCiphertext: dummyCiphertext,
        apiKeyLast4: "test",
        isPrimary: false,
        isEnabled: true,
        priority: 30,
        timeoutMs: 5000,
        firstTokenTimeoutMs: 1500,
        healthStatus: "healthy",
      },
    });
    gwCId = gwC.id;

    const upA = await db.upstreamModel.create({
      data: {
        gatewayId: gwA.id,
        modelKey: "model-a",
        isAvailable: true,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
    const upB = await db.upstreamModel.create({
      data: {
        gatewayId: gwB.id,
        modelKey: "model-b",
        isAvailable: true,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
    const upC = await db.upstreamModel.create({
      data: {
        gatewayId: gwC.id,
        modelKey: "model-c",
        isAvailable: true,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });

    const catalog = await db.catalogModel.create({
      data: {
        publicId: testPublicModelId,
        displayName: "Test Model",
        shortName: "Test",
        providerId: provider.id,
        status: "active",
      },
    });
    catalogModelId = catalog.id;

    await db.catalogModelRoute.createMany({
      data: [
        { catalogModelId: catalog.id, upstreamModelId: upA.id, priority: 1, isEnabled: true },
        { catalogModelId: catalog.id, upstreamModelId: upB.id, priority: 2, isEnabled: true },
        { catalogModelId: catalog.id, upstreamModelId: upC.id, priority: 3, isEnabled: true },
      ],
    });

    clearCandidateCache();
    resetCircuit();

    // 2. Test candidate resolution priority: A (pri 1) -> B (pri 2) -> C (pri 3)
    console.log("[2] Testing resolveCandidates order (pure priority)...");
    const r1 = await resolveCandidates(testPublicModelId, { forceRefresh: true });
    assert(r1.candidates.length === 3, `Expected 3 candidates, got ${r1.candidates.length}`);
    assert(r1.candidates[0].gateway.id === gwA.id, "Candidate 0 is A");
    assert(r1.candidates[1].gateway.id === gwB.id, "Candidate 1 is B");
    assert(r1.candidates[2].gateway.id === gwC.id, "Candidate 2 is C");
    console.log("   Candidate resolution order matches DB priority.");

    // 3. Test primary gateway swap in DB -> candidate order changes immediately
    console.log("[3] Testing primary gateway swap (making C primary)...");
    // Only one primary allowed by unique index
    if (originalPrimary) {
      await db.gateway.update({
        where: { id: originalPrimary.id },
        data: { isPrimary: false },
      });
    }
    await db.gateway.update({
      where: { id: gwC.id },
      data: { isPrimary: true },
    });
    clearCandidateCache();

    const r2 = await resolveCandidates(testPublicModelId, { forceRefresh: true });
    assert(r2.candidates[0].gateway.id === gwC.id, "Primary C is pushed to front!");
    assert(r2.candidates[1].gateway.id === gwA.id, "Candidate 1 is now A");
    assert(r2.candidates[2].gateway.id === gwB.id, "Candidate 2 is now B");
    console.log("   Primary-first reordering works live from DB.");

    // Restore original primary (or keep C not primary) for subsequent tests
    await db.gateway.update({
      where: { id: gwC.id },
      data: { isPrimary: false },
    });
    if (originalPrimary) {
      await db.gateway.update({
        where: { id: originalPrimary.id },
        data: { isPrimary: true },
      });
    }
    clearCandidateCache();
    resetCircuit();

    // 4. Test Fallback A (500) -> B (200 success)
    console.log("[4] Testing execution fallback: A returns 500, B returns 200...");
    state.aMode = "500";
    state.bMode = "ok";
    state.requestLog = [];

    const stream1 = executeWithFallback({
      publicModelId: testPublicModelId,
      request: {
        messages: [{ role: "user", content: "Hi" }],
      },
    });
    const text1 = await collectStreamText(stream1);
    assert(text1 === "Hello from B!", `Expected "Hello from B!", got "${text1}"`);
    assert(
      state.requestLog.some((l) => l.includes("/gw-a/")),
      "Gateway A was attempted"
    );
    assert(
      state.requestLog.some((l) => l.includes("/gw-b/")),
      "Gateway B was attempted"
    );
    console.log("   Fallback A(500) -> B(200) succeeded with expected text.");

    // Check routing_attempts in DB
    const attempts = await db.routingAttempt.findMany({
      where: { catalogModelId: catalog.id },
      orderBy: { id: "desc" },
      take: 2,
    });
    assert(attempts.length >= 2, "Logged at least 2 attempts");
    const lastAttempt = attempts[0];
    const prevAttempt = attempts[1];
    assert(lastAttempt.outcome === "success", "Last attempt was success");
    assert(prevAttempt.outcome === "fallback", "Previous attempt was fallback");
    console.log("   DB routing_attempts recorded outcomes: fallback, then success.");

    // 5. Test Fallback A (429) -> B (404) -> C (200 success)
    console.log("[5] Testing 3-gateway chain fallback: A(429) -> B(404) -> C(200)...");
    state.aMode = "429";
    state.bMode = "404";
    state.cMode = "ok";
    state.requestLog = [];

    const stream2 = executeWithFallback({
      publicModelId: testPublicModelId,
      request: {
        messages: [{ role: "user", content: "Hi again" }],
      },
    });
    const text2 = await collectStreamText(stream2);
    assert(text2 === "Hello from C!", `Expected "Hello from C!", got "${text2}"`);
    assert(state.requestLog.some((l) => l.includes("/gw-a/")), "Gateway A hit");
    assert(state.requestLog.some((l) => l.includes("/gw-b/")), "Gateway B hit");
    assert(state.requestLog.some((l) => l.includes("/gw-c/")), "Gateway C hit");
    console.log("   3-step fallback A(429) -> B(404) -> C(200) verified.");

    // 6. Test First Token Timeout on A -> fallback to B
    console.log("[6] Testing firstTokenTimeoutMs on A -> fallback to B...");
    state.aMode = "timeout";
    state.bMode = "ok";
    state.requestLog = [];

    const stream3 = executeWithFallback({
      publicModelId: testPublicModelId,
      request: {
        messages: [{ role: "user", content: "Hi" }],
      },
    });
    const text3 = await collectStreamText(stream3);
    assert(text3 === "Hello from B!", `Expected "Hello from B!", got "${text3}"`);
    console.log("   First-token timeout triggered fallback as expected.");

    // 7. Test Circuit Breaker: threshold consecutive failures trips the circuit
    console.log("[7] Testing circuit breaker trips after consecutive failures...");
    state.aMode = "500";
    state.bMode = "500";
    state.cMode = "500";
    resetCircuit();

    // Trigger failures until circuit trips
    const threshold = settings.circuitFailureThreshold;
    for (let i = 0; i < threshold; i += 1) {
      try {
        const stream = executeWithFallback({
          publicModelId: testPublicModelId,
          request: {
            messages: [{ role: "user", content: `Failing ${i}` }],
          },
        });
        await collectStreamText(stream);
      } catch (err) {
        assert(err instanceof ApiError && err.status === 503, "Failed with 503");
      }
    }

    // Next resolution should drop open gateways
    const rCircuit = await resolveCandidates(testPublicModelId, { forceRefresh: true });
    // Since all 3 tripped, resolver uses half-open (the one closing soonest) so it is never total blackout
    assert(rCircuit.candidates.length === 1, `Expected 1 half-open candidate, got ${rCircuit.candidates.length}`);
    console.log("   Circuit breaker tripped and safely engaged half-open candidate.");

    // 8. Test total exhaustion throws ApiError.modelUnavailable (503)
    console.log("[8] Testing total exhaustion throws 503 MODEL_UNAVAILABLE...");
    let caught: unknown = null;
    try {
      const stream = executeWithFallback({
        publicModelId: testPublicModelId,
        request: {
          messages: [{ role: "user", content: "Doom" }],
        },
      });
      await collectStreamText(stream);
    } catch (err) {
      caught = err;
    }
    assert(caught instanceof ApiError, "Caught error is ApiError");
    const apiError = caught as ApiError;
    assert(apiError.status === 503, "Status is 503");
    assert(apiError.code === "MODEL_UNAVAILABLE", "Code is MODEL_UNAVAILABLE");
    console.log("   Exhaustion correctly throws 503 MODEL_UNAVAILABLE.");

    console.log("✅ All Phase 3 smart routing assertions passed successfully!");
  } finally {
    console.log("[cleanup] Cleaning up test rows and restoring original primary...");
    try {
      // Restore original primary if needed
      if (originalPrimary) {
        const currentPrimary = await db.gateway.findFirst({
          where: { isPrimary: true },
        });
        if (currentPrimary && currentPrimary.id !== originalPrimary.id) {
          await db.gateway.update({
            where: { id: currentPrimary.id },
            data: { isPrimary: false },
          });
          await db.gateway.update({
            where: { id: originalPrimary.id },
            data: { isPrimary: true },
          });
        }
      }

      // Delete catalogModel (cascades routes)
      if (catalogModelId) {
        await db.catalogModel.delete({ where: { id: catalogModelId } }).catch(() => {});
      }
      // Delete test gateways (cascades upstream_models)
      if (gwAId) await db.gateway.delete({ where: { id: gwAId } }).catch(() => {});
      if (gwBId) await db.gateway.delete({ where: { id: gwBId } }).catch(() => {});
      if (gwCId) await db.gateway.delete({ where: { id: gwCId } }).catch(() => {});

      // Clean test routing_attempts
      await db.routingAttempt.deleteMany({
        where: {
          gatewayId: { in: [gwAId, gwBId, gwCId].filter((id) => id > 0n) },
        },
      });
    } catch (cleanErr) {
      console.error("[cleanup] Error cleaning up:", cleanErr);
    }

    server.close();
    await db.$disconnect();
    console.log("[cleanup] Disconnected and server closed.");
  }
}

run().catch((err) => {
  console.error("FATAL TEST FAILURE:", err);
  process.exit(1);
});
